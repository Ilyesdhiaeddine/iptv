const playlistParser = require('iptv-playlist-parser')
const epgParser = require('epg-parser')
const utils = require('./utils')
const categories = require('./categories')

const parser = {}

parser.parseIndex = function () {
  const content = utils.readFile('index.m3u')
  const result = playlistParser.parse(content)

  return result.items
}

parser.parsePlaylist = function (filename) {
  const content = utils.readFile(filename)
  const result = playlistParser.parse(content)

  return new Playlist({ header: result.header, items: result.items, url: filename })
}

parser.parseEPG = async function (url) {
  return utils.loadEPG(url).then(content => {
    const result = epgParser.parse(content)
    const channels = {}
    for (let channel of result.channels) {
      channels[channel.id] = channel
    }

    return { url, channels }
  })
}

class Playlist {
  constructor({ header, items, url }) {
    this.url = url
    this.header = header
    this.channels = items
      .map(item => new Channel({ data: item, header, sourceUrl: url }))
      .filter(channel => channel.url)
  }

  toString(short = false) {
    let parts = ['#EXTM3U']
    for (let key in this.header.attrs) {
      let value = this.header.attrs[key]
      if (value) {
        parts.push(`${key}="${value}"`)
      }
    }

    let output = `${parts.join(' ')}\n`
    for (let channel of this.channels) {
      output += channel.toString(short)
    }

    return output
  }
}

class Channel {
  constructor({ data, header, sourceUrl }) {
    this.parseData(data)

    if (!this.countries.length) {
      const filename = utils.getBasename(sourceUrl)
      const countryName = utils.code2name(filename)
      this.countries = countryName ? [{ code: filename.toLowerCase(), name: countryName }] : []
      this.tvg.country = this.countries.map(c => c.code.toUpperCase()).join(';')
    }

    this.tvg.url = header.attrs['x-tvg-url'] || ''
  }

  parseData(data) {
    const title = this.parseTitle(data.name)

    this.tvg = data.tvg
    this.http = data.http
    this.url = data.url
    this.logo = data.tvg.logo
    this.name = title.channelName
    this.status = title.streamStatus
    this.resolution = title.streamResolution
    this.countries = this.parseCountries(data.tvg.country)
    this.languages = this.parseLanguages(data.tvg.language)
    this.category = this.parseCategory(data.group.title)
  }

  parseCountries(string) {
    let arr = string
      .split(';')
      .reduce((acc, curr) => {
        const codes = utils.region2codes(curr)
        if (codes.length) {
          for (let code of codes) {
            if (!acc.includes(code)) {
              acc.push(code)
            }
          }
        } else {
          acc.push(curr)
        }

        return acc
      }, [])
      .filter(code => code && utils.code2name(code))

    return arr.map(code => {
      return { code: code.toLowerCase(), name: utils.code2name(code) }
    })
  }

  parseLanguages(string) {
    return string
      .split(';')
      .map(name => {
        const code = name ? utils.language2code(name) : null
        if (!code) return null

        return {
          code,
          name
        }
      })
      .filter(l => l)
  }

  parseCategory(string) {
    const category = categories.find(c => c.id === string.toLowerCase())

    return category ? category.name : ''
  }

  parseTitle(title) {
    const channelName = title
      .trim()
      .split(' ')
      .map(s => s.trim())
      .filter(s => {
        return !/\[|\]/i.test(s) && !/\((\d+)P\)/i.test(s)
      })
      .join(' ')

    const streamStatusMatch = title.match(/\[(.*)\]/i)
    const streamStatus = streamStatusMatch ? streamStatusMatch[1] : null

    const streamResolutionMatch = title.match(/\((\d+)P\)/i)
    const streamResolutionHeight = streamResolutionMatch ? parseInt(streamResolutionMatch[1]) : null
    const streamResolution = { width: null, height: streamResolutionHeight }

    return { channelName, streamStatus, streamResolution }
  }

  get tvgCountry() {
    return this.tvg.country
      .split(';')
      .map(code => utils.code2name(code))
      .join(';')
  }

  get tvgLanguage() {
    return this.tvg.language
  }

  get tvgUrl() {
    return (this.tvg.id || this.tvg.name) && this.tvg.url ? this.tvg.url : ''
  }

  toString(short = false) {
    this.tvg.country = this.tvg.country.toUpperCase()

    let info = `-1 tvg-id="${this.tvg.id}" tvg-name="${this.tvg.name}" tvg-country="${this.tvg.country}" tvg-language="${this.tvg.language}" tvg-logo="${this.logo}"`

    if (!short) {
      info += ` tvg-url="${this.tvgUrl}"`
    }

    info += ` group-title="${this.category}",${this.name}`

    if (this.resolution.height) {
      info += ` (${this.resolution.height}p)`
    }

    if (this.status) {
      info += ` [${this.status}]`
    }

    if (this.http['referrer']) {
      info += `\n#EXTVLCOPT:http-referrer=${this.http['referrer']}`
    }

    if (this.http['user-agent']) {
      info += `\n#EXTVLCOPT:http-user-agent=${this.http['user-agent']}`
    }

    return '#EXTINF:' + info + '\n' + this.url + '\n'
  }

  toJSON() {
    return {
      name: this.name,
      logo: this.logo || null,
      url: this.url,
      category: this.category || null,
      languages: this.languages,
      countries: this.countries,
      tvg: {
        id: this.tvg.id || null,
        name: this.tvg.name || null,
        url: this.tvg.url || null
      }
    }
  }
}

module.exports = parser
