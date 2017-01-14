const HOME_PATH = process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME']

exports.resolveHome = pathStr => pathStr.replace(/^~(\/|$)/, `${HOME_PATH}$1`)
exports.uuid = () => Date.now().toString(36) + Math.random().toString(36).substring(2)
exports.getAppDir = app => {
	const [, owner, repo] = app.repository.match(/.+?([^\/|:]+?)\/([^\/]+?)\.git/)
	const branch = app.branch || 'master'
	return `${owner}/${repo}@${branch}`
}