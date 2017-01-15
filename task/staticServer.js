const path = require('path')
const program = require('commander')
const express = require('express')

program.option('-r, --root <root>', 'Set root path')
program.option('-n, --404 <404>', 'Set 404 file')
program.option('-f, --fallback <fallback>', 'Set fallback file')
program.parse(process.argv)

const cwd = process.cwd()
const root = program.root || './'
const absoluteRoot = path.join(cwd, root)
const statusCode = program.fallback ? 200 : 404
const notFoundFile = program.fallback || program['404'] || '404.html'

const app = express()
app.use(express.static(root))
app.all('*', (req, res) => {
	res.status(statusCode).sendFile(notFoundFile, {
		root: absoluteRoot
	})
})
app.listen(process.env.PORT)