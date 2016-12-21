#!/usr/bin/env node
const program = require('commander')
const info = require('../package.json')
const easyPm = require('../')

program
	.version(info.version)
	.command('start <path>')
	.action(path => easyPm.start(path))
	.command('list')
	.action(() => easyPm.list())

program.parse(process.argv)