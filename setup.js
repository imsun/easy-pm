const fs = require('fs-promise')
const http = require('http')
const path = require('path')
const request = require('request')
const shell = require('shelljs')
const resolveHome = require('./resolveHome')

const homeDir = resolveHome('~/.easy-pm')
const configsFile = path.resolve(homeDir, './configs')

fs.readFile(configsFile, 'utf8')
	.then(configsStr => {
		const configs = configsStr.split('\n').filter(s => !/^\s*$/.test(s))
		configs.forEach(configPath => {
			fs.readFile(configPath, 'utf8')
				.then(configStr => {
					const config = JSON.parse(configStr)
					const root = path.resolve(configPath, resolveHome(config.root))
					const appInit = initFactory(root, config)
					config.apps.forEach(appInit)
				})
		})
		return configs
	})

function initFactory(root, config) {
	const port = config.port || 80

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
	return function(app) {
		const branch = app.branch || 'master'
		const appPath = path.resolve(root, `${app.name}-${branch}`)

		fs.exists(appPath)
			.then(exists => {
				if (!exists) {
					if (app.repository) {
						shell.exec(`git clone ${app.repository} ${appPath} && cd ${appPath} && git checkout ${branch} && npm install`)
					} else {
						console.log(`Can't setup ${app.name}`)
					}
				} else {
					shell.exec(`cd ${appPath} && git checkout ${branch}`, { silent: true })
					console.log(`${appPath}: checking for updates...`)
					shell.exec(`cd ${appPath} && git pull`)
					console.log(`${appPath}: installing dependencies...`)
					shell.exec(`cd ${appPath} && npm install --loglevel=error`)
					console.log('Dependencies installed.')
				}

				if (config.webhook && config.webhook.host && config.webhook.token && app.repository) {
					const [, owner, repo] = app.repository.match(/.*?github\.com.(.+?)\/(.+?)\.git/)

					if (owner && repo) {
						request({
							headers,
							url: `${GITHUB_API_HOST}/repos/${owner}/${repo}/hooks`
						}, (err, res, body) => {
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
						})
					}
				}
			})
	}
}