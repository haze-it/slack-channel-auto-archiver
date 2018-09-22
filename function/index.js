'use strict'

const slack_api = require('./slack_api.js')
const spreadsheet = require('./spreadsheet.js')

module.exports = {
  slack_channel_archiver: async function(req, res) {
    let req_body = req.body
    console.log('request.body: ' + JSON.stringify(req_body))

    // dry run?
    let prd_flg = is_prd(req_body)

    // Fetch Ignore List
    let ignore_list
    try {
      ignore_list = await spreadsheet.fetch()
    } catch (e) {
      let msg = 'ERROR: Fetch ignore list'
      console.log(msg)
      res.status(501).send(msg)
      return
    }

    // fetch channels list
    let channels_list
    try {
      channels_list = await slack_api.fetch_channels_list()
    } catch (e) {
      let msg  = 'ERROR: Fetch channels list'
      console.log(msg)
      res.status(501).send(msg)
      return
    }

    // narrow down channels
    let will_archive_channels
    try {
      will_archive_channels = await slack_api.narrow_down_list(channels_list)
    } catch (e) {
      let msg = 'ERROR: narrow down channels'
      console.log(msg)
      res.status(501).send(msg)
      return
    }

    // will_archive_list - ignore_list
    let archive_channels_list = ignore_list_channels(will_archive_channels, ignore_list)

    // Dry Run?
    if (! prd_flg) {
      let msg = "Dry Run. If you want to run in production, please set arguments."
      let status_msg = create_archive_status_msg(archive_channels_list, msg)
      console.log(status_msg)
      res.status(200).send(status_msg)
      return
    }

    // announcement and archive
    let channels_status
    try {
      channels_status = await slack_api.channel_list_archive(archive_channels_list)
    } catch (rejected_channel_status) {
      let msg = "Channel archive succeeded. Please check the log."
      let status_msg = create_archive_status_msg(channels_status, msg)
      console.log(status_msg)
      res.status(200).send(status_msg)
      return
    }

    let msg = "Channel archive succeeded. Please check the log."
    let status_msg = create_archive_status_msg(channels_status, msg)
    console.log(status_msg)
    res.status(200).send(status_msg)
    return
  }
}

// Function
function is_prd(req_body) {
  if (req_body.prd == "true") {
    console.log('[PRODUCTION MODE]')
    return true
  } else {
    console.log('[DRY RUN MODE]')
    return false
  }
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

function create_archive_status_msg(archive_list, msg) {
  msg += "\n\n"

  let count = 0
  let archive_count = 0
  let none_count    = 0
  let result_msg = '|    id    | status | channel.name | ' + "\n"

  archive_list.forEach(channel => {
    if (channel.archive_target != "1") {
      return
    }
    count += 1
    let status
    if (channel.archive_status == "1") {
      status = " archived "
      archive_count += 1
    } else {
      status = "   none   "
      none_count += 1
    }
    let channel_line = ' ' + channel.id + ' ' + status + ' ' + channel.name
    result_msg += channel_line + "\n"
  })

  let status_msg = 
    "Total   : " + String(count)         + "\n" +
    "Archived: " + String(archive_count) + "\n" +
    "None    : " + String(none_count)    + "\n"

  result_msg = msg + status_msg + result_msg

  return result_msg
}