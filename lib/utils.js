const net = require('net')
const crypto = require('crypto')
const HOME_PATH = process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME']

const resolveHome = pathStr => pathStr.replace(/^~(\/|$)/, `${HOME_PATH}$1`)
const uuid = () => Date.now().toString(36) + Math.random().toString(36).substring(2)
const getHash = s => crypto.createHash('sha1').update(s).digest('hex')

function getAppDir(app) {
	const [, owner, repo] = app.repository.match(/.+?([^\/|:]+?)\/([^\/]+?)\.git/)
	const branch = app.branch || 'master'
	return `${owner}/${repo}@${branch}`
}

let portStart = 18000
function getPort(callback) {
	const port = portStart++

	const server = net.createServer()
	server.listen(port, () => {
		server.once('close', () => callback(port))
		server.close()
	})
	server.on('error', () => getPort(callback))
}
const getFreePort = () => new Promise(resolve => getPort(resolve))

module.exports = { resolveHome, uuid, getHash, getAppDir, getFreePort }