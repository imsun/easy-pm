#!/usr/bin/env node
const program = require('commander')
const info = require('../package.json')
const easyPm = require('../')

program.version(info.version)

program.command('start <file>')
	.description('start service with config file')
	.action(file => easyPm.start(file))

program.command('stop <file>')
	.description('stop service with config file')
	.action(file => easyPm.stop(file))

program.command('list')
	.description('list running applications')
	.action(() => easyPm.list())

program.parse(process.argv)