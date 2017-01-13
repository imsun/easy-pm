const path = require('path')
const HOME_PATH = process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME']

exports.resolveHome = pathStr => pathStr.replace(/^~(\/|$)/, `${HOME_PATH}$1`)
exports.uuid = () => Date.now().toString(36) + Math.random().toString(36).substring(2)