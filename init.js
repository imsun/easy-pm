const http = require('http')
const path = require('path')
const request = require('request')
const shell = require('shelljs')
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

config.apps.forEach(app => {
	const appPath = path.resolve(config.root, app.path || app.name)
	const files = shell.ls(appPath)

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
})