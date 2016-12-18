const crypto = require('crypto')
const http = require('http')
const path = require('path')
const request = require('request')
const shell = require('shelljs')
const pm2 = require('pm2')
const proxy = require('http-proxy').createProxyServer({})
const config = require('./config')

config.root = config.root || ''
const port = process.env.PORT || config.port || 80
const portPart = port === 80 || port === 443 ? '' : `:${port}`
const hooksRe = new RegExp(`^(.*?//)*${config.webhook.host}/hooks`, 'i')
const GITHUB_API_HOST = 'https://api.github.com'
const headers = {
	'User-Agent': 'easy-pm',
	'Accept': 'application/vnd.github.v3+json'
}
if (config.webhook.token) {
	headers.Authorization = `token ${config.webhook.token}`
}

const routes = {}

const apps = config.apps.map(app => {
	const appPath = path.resolve(config.root, app.path || app.name)
	const port = app.port || ''
	const files = shell.ls(appPath)

	if (app.domains) {
		app.domains.forEach(domain => {
			routes[domain] = port
		})
	}

	if (files.stderr !== null) {
		if (app.repository) {
			const branch = app.branch || 'master'
			shell.exec(`git clone ${app.repository} ${appPath} && cd ${appPath} && git checkout ${branch} && npm install`)
		} else {
			console.log(`Can't find ${appPath}`)
		}
	}

	if (app.repository) {
		const [, owner, repo] = app.repository.match(/.*?github\.com.(.+?)\/(.+?)\.git/)

		if (owner && repo) {
			request({
				headers,
				url: `${GITHUB_API_HOST}/repos/${owner}/${repo}/hooks`
			}, (err, res, body) => {
				try {
					const hooks = JSON.parse(body)
					let matchedHook = ''
					const haveHooks = hooks.reduce((prev, current) => {
						if (hooksRe.test(current.config.url)) {
							matchedHook = current.id
							console.log(current.config.url)
						}
						return prev || hooksRe.test(current.config.url)
					}, false)
					if (!haveHooks) {
						request({
							headers,
							method: 'POST',
							url: `${GITHUB_API_HOST}/repos/${owner}/${repo}/hooks`,
							json: {
								name: 'web',
								active: true,
								events: ['push'],
								config: {
									url: `${config.webhook.host}${portPart}/hooks/${app.name}`,
									content_type: 'json',
									secret: config.webhook.token
								}
							}
						})
					}
				} catch (e) {
					console.log(res.body)
				}
			})
		}
	}

	return {
		name: app.name,
		cwd: appPath,
		script: 'npm',
		args: 'start',
		watch: true,
		env: {
			PORT: port
		}
	}
})

http.createServer((req, res) => {
	const host = req.headers.host.split(':')[0]
	if (routes[host]) {
		proxy.web(req, res, {
			target: `http://127.0.0.1:${routes[host]}`
		})
	} else {
		console.log(req.headers)
		const chunks = []
		const hookedApp = apps.find(app => {
			const re = new RegExp(`^/hooks/${app.name}/?([\?|#].*)?$`)
			return re.test(req.url)
		})
		if (hookedApp) {
			const branch = hookedApp.branch || 'master'
			const appPath = path.resolve(config.root, hookedApp.path || hookedApp.name)
			req.on('data', chunk => chunks.push(chunk))
				.on('end', () => {
					const body = Buffer.concat(chunks).toString()
					const ghSignature = req.headers['x-hub-signature'].replace(/^sha1=/, '')
					const signature = crypto.createHmac('sha1', config.webhook.token).update(body).digest('hex')
					if (signature === ghSignature) {
						shell.exec(`cd ${appPath} && git pull && git checkout ${branch} && npm install`)
					}
				})
		}
		res.end()
	}
}).listen(port)

pm2.connect(function(err) {
	if (err) {
		console.log(err)
		process.exit(2)
	}

	pm2.start({ apps }, function(err, apps) {
		pm2.disconnect()
		if (err) throw err
	})
})
