const path = require('path')
const HOME_PATH = process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME']

module.exports = pathStr => {
	return pathStr.replace(/^~(\/|$)/, `${HOME_PATH}$1`)
}