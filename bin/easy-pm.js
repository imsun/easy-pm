#!/usr/bin/env node
const program = require('commander')
const info = require('../package.json')
const easyPm = require('../')

program
	.version(info.version)
	.command('start <file>')
	.action(file => easyPm.start(file))

program.command('list')
	.action(() => easyPm.list())

program.parse(process.argv)