'use strict'

const BASE_URL = 'https://slack.com/api/'

const request = require('request')
const Settings = require('./settings.json')

module.exports = {
  fetch_channels_list: async function() {
    return new Promise(async function(onFulfilled, onRejected) {
      let req_form = {
        token: process.env.SLACK_AUTH_TOKEN, exclude_archived: 'true'
      }
      let url = BASE_URL + 'channels.list'
      let form = { form: req_form }

      let channels_list
      try {
        channels_list = await postRequest(url, form)
      } catch (e) {
        console.log('fetch_channels_list err: ' + e)
        return onRejected(e)
      }
      channels_list = channels_list.channels
      return onFulfilled(channels_list)
    })
  },

  narrow_down_list: async function(channels_list) {
    return new Promise(async function(onFulfilled, onRejected) {
      let now = Date.now() / 1000   // 桁合わせ
      let BOUNDARY_SEC_TIME = Settings.archive_day * 24 * 60 * 60
      console.log('boudary sec time: ' + String(BOUNDARY_SEC_TIME))

      let promises = []
      channels_list.forEach(function(channel) {
        promises.push(narrow_down_channel(channel, now, BOUNDARY_SEC_TIME))
      })

      Promise.all(promises)
      .then(function(will_archive_channels) {
        console.log('in Promise.all will_archive_channels: ' + JSON.stringify(will_archive_channels))
        return onFulfilled(will_archive_channels)
      })
      .catch(function(e) {
        console.log('narrow_down_list err. err: ' + e)
        return onRejected(e)
      })
    })
  },

  ignore_list_channels: async function(will_archive_channels, ignore_list) {
    will_archive_channels.forEach( function(channel, index, arr) {
      if (channel.archive_target == "1" && ignore_list.indexOf(channel.name) != -1 ) {
        console.log('ignore_list_channels: channel[' + channel.name + '] is ignore.' )
        will_archive_channels[index].archive_target = "0"
      }
    })
    return will_archive_channels
  },

  channel_list_archive(channels_list) {
    return new Promise(async function(onFulfilled, onRejected) {
      let promises = []
      channels_list.forEach(function(channel) {
        if (channel.archive_target == '1') promises.push(channel_archive(channel))
      })
  
      Promise.all(promises)
      .then(function(results) {
        console.log('channels archive success.')
        return onFulfilled(results)
      })
      .catch(function(results) {
        console.log('channels archive Partially success.')
        return onFulfilled(results)
      })
    })
  }
}

// Functions
function narrow_down_channel(channel, now, boundary_sec_time) {
  return new Promise(async function(onFulfilled, onRejected) {
    channel.archive_target = '0'
    channel.archive_status = '0'

    // is_private
    if (channel.is_private == true) {
      return onFulfilled(channel)
    }


    // Member.count is 0?
    if (channel.num_members == '0') {
      channel.archive_target = '1'
      console.log('channel: ' + channel.name + ' member is zero.')
      return onFulfilled(channel)
    }

    // now - last message ts > DAY * 24 * 60 * 60
    let req_form = {
      token: process.env.SLACK_AUTH_TOKEN, channel: channel.id, count: 1
    }
    let form = { form: req_form }
    let url = BASE_URL + 'channels.history'

    let channel_history
    try {
      channel_history = await postRequest(url, form)
    } catch(e) {
      console.log('channels.history ERROR.')
      return onRejected(e)
    }
    // has not message
    if (channel_history.messages[0] == null) {
      console.log('channel:' + channel.name + ' has not message. not archive.')
      return onFulfilled(channel)
    }
    let latest_ts = channel_history.messages[0].ts
    let latest_msg_time = Number(latest_ts.slice(0, 10))

    let diffrence = now - latest_msg_time
    if( diffrence > boundary_sec_time ) {
      console.log( 'channel: ' + channel.name + ' (second) difference: ' + String(diffrence))
      channel.archive_target = '1'
      return onFulfilled(channel)
    }
    return onFulfilled(channel)
  })
}

function channel_archive(channel) {
  return new Promise(async function(onFulfilled, onRejected) {
    // Post Last Message
    let archive_msg = "Archive This Channel. Because it is not use. :knife:"
    let req_form = {
      token: process.env.SLACK_BOT_TOKEN, channel: channel.id, text: archive_msg
    }
    let form = { form: req_form }
    let url = BASE_URL + 'chat.postMessage'

    let result
    try {
      result = await postRequest(url, form)
    } catch(err) {
      console.log('channel_archive chat.postMessage err: ' + err)
      return onFulfilled(channel)
    }

    // Archive
    req_form = {
      token: process.env.SLACK_AUTH_TOKEN, channel: channel.id
    }

    form = { form: req_form }
    url = BASE_URL + 'channels.archive'

    result = {}
    try {
      result = await postRequest(url, form)
    } catch(err) {
      console.log('channel_archive channels.archive err: ' + err)
      return onFulfilled(channel)
    }
    console.log('channel archive success (channel: ' + channel.name + ')')
    channel.archive_status = "1"
    return onFulfilled(channel)
  })
}

function postRequest(url, form) {
  return new Promise(function(onFulfilled, onRejected) {
    request.post (url, form, (e, response, body) => {
        body = JSON.parse(body)

        console.log('response: ' + JSON.stringify(response))
        console.log('response body: ' + JSON.stringify(body))

        if (e != undefined || body.ok != true ) {
          console.log('request.post err_body: ' + JSON.stringify(body))
          return onRejected(e)
        }
        return onFulfilled(body)
      }
    )
  })
}
