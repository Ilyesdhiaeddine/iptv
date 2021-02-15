const { program } = require('commander')
const parser = require('./parser')
const utils = require('./utils')
const axios = require('axios')
const ProgressBar = require('progress')
const https = require('https')

program
  .usage('[OPTIONS]...')
  .option('-d, --debug', 'Debug mode')
  .option('-c, --country <country>', 'Comma-separated list of country codes', '')
  .option('-e, --exclude <exclude>', 'Comma-separated list of country codes to be excluded', '')
  .option('--epg', 'Turn on EPG parser')
  .option('--resolution', 'Turn on resolution parser')
  .option('--delay <delay>', 'Delay between parser requests', 0)
  .option('--timeout <timeout>', 'Set timeout for each request', 5000)
  .parse(process.argv)

const config = program.opts()

const instance = axios.create({
  timeout: config.timeout,
  maxContentLength: 20000,
  httpsAgent: new https.Agent({
    rejectUnauthorized: false
  })
})

let globalBuffer = []

async function main() {
  const playlists = parseIndex()

  for (const playlist of playlists) {
    await loadPlaylist(playlist.url)
      .then(addToBuffer)
      .then(sortChannels)
      .then(removeDuplicates)
      .then(detectResolution)
      .then(updateFromEPG)
      .then(savePlaylist)
      .then(done)
  }

  if (playlists.length) {
    await loadPlaylist('channels/unsorted.m3u')
      .then(removeUnsortedDuplicates)
      .then(sortChannels)
      .then(savePlaylist)
      .then(done)
  }

  finish()
}

function parseIndex() {
  console.info(`Parsing 'index.m3u'...`)
  let playlists = parser.parseIndex()
  playlists = utils
    .filterPlaylists(playlists, config.country, config.exclude)
    .filter(i => i.url !== 'channels/unsorted.m3u')
  console.info(`Found ${playlists.length} playlist(s)\n`)

  return playlists
}

async function loadPlaylist(url) {
  console.info(`Processing '${url}'...`)
  return parser.parsePlaylist(url)
}

async function addToBuffer(playlist) {
  if (playlist.url === 'channels/unsorted.m3u') return playlist
  globalBuffer = globalBuffer.concat(playlist.channels)

  return playlist
}

async function sortChannels(playlist) {
  console.info(`  Sorting channels...`)
  playlist.channels = utils.sortBy(playlist.channels, ['name', 'url'])

  return playlist
}

async function removeDuplicates(playlist) {
  console.info(`  Looking for duplicates...`)
  let buffer = {}
  const channels = playlist.channels.filter(i => {
    const result = typeof buffer[i.url] === 'undefined'
    if (result) {
      buffer[i.url] = true
    }

    return result
  })

  playlist.channels = channels

  return playlist
}

async function detectResolution(playlist) {
  if (!config.resolution) return playlist
  const bar = new ProgressBar('  Detecting resolution: [:bar] :current/:total (:percent) ', {
    total: playlist.channels.length
  })
  const results = []
  for (const channel of playlist.channels) {
    bar.tick()
    const url = channel.url
    const response = await instance
      .get(url)
      .then(utils.sleep(config.delay))
      .catch(err => {})
    if (response) {
      if (response.status === 200) {
        if (/^#EXTM3U/.test(response.data)) {
          const resolution = parseResolution(response.data)
          if (resolution) {
            channel.resolution = resolution
          }
        }
      }
    }

    results.push(channel)
  }

  playlist.channels = results

  return playlist
}

function parseResolution(string) {
  const regex = /RESOLUTION=(\d+)x(\d+)/gm
  const match = string.matchAll(regex)
  const arr = Array.from(match).map(m => ({
    width: parseInt(m[1]),
    height: parseInt(m[2])
  }))

  return arr.length
    ? arr.reduce(function (prev, current) {
        return prev.height > current.height ? prev : current
      })
    : undefined
}

async function updateFromEPG(playlist) {
  if (!config.epg) return playlist
  const tvgUrl = playlist.header.attrs['x-tvg-url']
  if (!tvgUrl) return playlist

  console.info(`  Adding data from '${tvgUrl}'...`)

  return utils
    .parseEPG(tvgUrl)
    .then(epg => {
      if (!epg) return playlist

      playlist.channels.map(channel => {
        if (!channel.tvg.id) return channel
        const epgItem = epg.channels[channel.tvg.id]
        if (!epgItem) return channel
        if (!channel.tvg.name && epgItem.name.length) {
          channel.tvg.name = epgItem.name[0].value
        }
        if (!channel.languages.length && epgItem.name.length && epgItem.name[0].lang) {
          channel.languages = utils.parseLanguages(epgItem.name[0].lang)
        }
        if (!channel.logo && epgItem.icon.length) {
          channel.logo = epgItem.icon[0]
        }
      })

      return playlist
    })
    .catch(err => {
      console.log(`Error: EPG could not be loaded`)
    })
}

async function removeUnsortedDuplicates(playlist) {
  console.info(`  Looking for duplicates...`)
  const urls = globalBuffer.map(i => i.url)
  const channels = playlist.channels.filter(i => !urls.includes(i.url))
  if (channels.length === playlist.channels.length) return playlist
  playlist.channels = channels

  return playlist
}

async function savePlaylist(playlist) {
  const original = utils.readFile(playlist.url)
  const output = playlist.toString(true)

  if (original === output) {
    console.info(`No changes have been made.`)
    return false
  } else {
    utils.createFile(playlist.url, output)
    console.info(`Playlist has been updated.`)
  }

  return true
}

async function done() {
  console.info(` `)
}

function finish() {
  console.info('Done.')
}

main()
