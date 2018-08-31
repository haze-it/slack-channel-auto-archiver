BASE_URL = 'https://slack.com/api/'

const request = require('request')
const Settings = require('./settings.json')
const Messages = require('./messages.json')

module.exports = {
  slack_channel_archiver: async function(req, res) {
    let req_body = req.body
    console.log('request.body: ' + JSON.stringify(req_body))

    // dry run?
    let prd_flg = is_prd(req_body)

    // Fetch: ignore list
    // TODO: Google Spreadsheetから引っ張ってくる or 引数に入れる
    // とりあえず消せない＋エラーで怒られるのでgeneralだけ追加しておく
    let ignore_list = ['general']

    // Fetch: channels list
    let channels_list
    try {
      channels_list = await fetch_channels_list()
    } catch (err) {
      let msg = error(err, Messages.error.fetch_channels_list)
      res.status(200).send(msg)
      return
    }
    console.log('channels_list: ' + JSON.stringify(channels_list))

    // narrow down channels
    let will_archive_channels
    try {
      will_archive_channels = await narrow_down_list(channels_list)
    } catch (err) {
      let msg = error(err, Messages.error.narrow_down_list)
      res.status(200).send(msg)
      return
    }
    console.log('will_archive_channels: ' + JSON.stringify(will_archive_channels))

    // will_archive_list - ignore_list channels
    let archive_channels_list
    try {
      archive_channels_list = ignore_list_channels(will_archive_channels, ignore_list)
    } catch (err) {
      let msg = error(err, Messages.error.archive_channels_list)
      res.status(200).send(msg)
      return
    }
    console.log('archive_channels_list: ' + JSON.stringify(archive_channels_list))

    // Dry Run
    if (! prd_flg) {
      let status_msg = create_archive_status_msg(archive_channels_list, Messages.info.dry_run)
      console.log(status_msg)
      res.status(200).send(status_msg)
      return
    }

    // announcement and archive
    let channels_status
    try {
      channels_status = await channel_list_archive(archive_channels_list)
    } catch (rejected_status) {
      let msg = error(err, Messages.error.channel_list_archive)
      res.status(200).send(msg)
      return
    }
    console.log('channels_status: ' + JSON.stringify(channels_status) )

    let status_msg = create_archive_status_msg(channels_status, Messages.info.success)
    console.log(status_msg)
    res.status(200).send(status_msg)
    return
  }
}

//////////////////
//// Functions
//

function error(err, msg) {
  console.log('ERROR: ' + JSON.stringify(err))
  let error_msg = '[ERROR] ' + msg
  return error_msg
}

function is_prd(req_body) {
  if (req_body.prd == "true") {
    console.log('[PRODUCTION MODE]')
    return true
  } else {
    console.log('[DRY RUN MODE]')
    return false
  }
}

function fetch_channels_list() {
  return new Promise(async function (onFulfilled, onRejected) {
    let req_form = {
      token: process.env.SLACK_AUTH_TOKEN, exclude_archived: 'true'
    }
    let url = BASE_URL + 'channels.list'
    let form = { form: req_form }

    let channels_list
    try {
      channels_list = await postRequest(url, form)
    } catch (err) {
      console.log('fetch channels list  err: ' + err)
      return onRejected(err)
    }
    channels_list = channels_list.channels
    return onFulfilled(channels_list)
  })
}

function narrow_down_list(channels_list) {
  return new Promise(async function (onFulfilled, onRejected) {
    // narrow down channels
    let now = Date.now() / 1000
    let BOUNDARY_SEC_TIME = Settings.archive_day * 24 * 60 * 60
    console.log('boundary sec time: ' + String(BOUNDARY_SEC_TIME))

    let promises = []
    channels_list.forEach(function(channel) {
      promises.push(narrow_down_channel(channel, now, BOUNDARY_SEC_TIME))
    })

    Promise.all(promises)
    .then(function(will_archive_channels) {
      console.log('in Promise.all will_archive_channels: ' + JSON.stringify(will_archive_channels))

      return onFulfilled(will_archive_channels)
    })
    .catch(function(err) {
      console.log('narrow_down_list err. err: ')
      console.log(err)
      return onRejected(err)
    })
  })
}

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
    } catch(err) {
      console.log('channels.history ERROR.')
      return onRejected(err)
    }
    // messageが無いとき
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

function ignore_list_channels(will_archive_channels, ignore_list) {
  will_archive_channels.forEach( function(channel, index, arr) {
    if (channel.archive_target == "1" && ignore_list.indexOf(channel.name) != -1 ) {
      console.log('ignore_list_channels: channel[' + channel.name + '] is ignore.' )
      will_archive_channels[index].archive_target = "0"
    }
  })
  return will_archive_channels
}

function channel_list_archive(channels_list) {
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

function channel_archive(channel) {
  return new Promise(async function(onFulfilled, onRejected) {
    // Post Last Message
    let req_form = {
      token: process.env.SLACK_BOT_TOKEN, channel: channel.id, text: Messages.archive_message
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

function create_archive_status_msg(archive_list, msg) {
  let result_msg = msg + "\n"
  result_msg += '|    id    | status | channel.name | ' + "\n"

  archive_list.forEach(channel => {
    if (channel.archive_target != "1") { return }
 
    let status = channel.archive_status == "1" ? ' archived ' : '   none   '
    let channel_line = ' ' + channel.id + ' ' + status + ' ' + channel.name
    result_msg += channel_line + "\n"
  })

  return result_msg
}

function postRequest(url, form) {
  return new Promise(function (onFulfilled, onRejected) {
    request.post (
      url, form, (err, response, body) => {
        body = JSON.parse(body)
        console.log('response body: ' + JSON.stringify(body))
        if (err != undefined || body.ok != true ) {
          console.log('request.post err_body: ' + JSON.stringify(body))
          console.log(err)
          return onRejected(err)
        }
        return onFulfilled(body)
      }
    )
  })
}