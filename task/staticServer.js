const program = require('commander')
const express = require('express')

program.option('-r, --root <root>', 'Set root path')

program.parse(process.argv)

const app = express()
app.use(express.static(program.root || './'))
app.listen(process.env.PORT)