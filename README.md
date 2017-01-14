# easy-pm

[![NPM version][npm-image]][npm-url]

[npm-image]: https://img.shields.io/npm/v/easy-pm.svg
[npm-url]: https://www.npmjs.com/package/easy-pm

A simple and easy-to-use web server for managing Node.js projects.

## Features

- Automatic HTTPS
- HTTP/2 & SPDY
- WebSockets
- Easy Deployment from GitHub
- Process Managing
- Virtual Hosts
- Gzip
- Static Server

## Installation

```bash
$ npm install easy-pm -g
```

## Usage

Just create a configuration file on your server and easy-pm start it.

### Basic Example

```bash
$ easy-pm start config.json
```

config.json:

```json
{
  "root": "/var/www",
  "ssl": {
    "sites": {
      "example.com": "auto",
      "www.example.com": "auto"
    }
  },
  "webhook": {
    "host": "your server address",
    "token": "your github token"
  },
  "apps": [
    {
      "name": "example",
      "domains": ["example.com", "www.example.com"],
      "repository": "git@github.com:your_github_id/example.git",
      "max_memory_restart": "100M"
    },
    {
      "name": "static-example",
      "domains": ["static-example.com"],
      "repository": "git@github.com:your_github_id/example.git",
      "branch": "gh-pages"
    }
  ]
}
```

easy-pm will clone all projects and `npm start` them

### Configuration File

- **root** - *string* the directory to put your applications
- **port** - *number* optional. the port easy-pm running on. default `80`
- **gzip** - *boolean* optional. whether enable gzip for all applications. default `true`
- **ssl** - *object* optional
    - **port** - *number* optional. the SSL port easy-pm running on. default `443`
    - **disable_redirect** - *boolean* optional. disable redirecting `http` requests to `https` for all sites. default `false`
    - **sites** - *object*
        - **[domain]** - *object* | *"auto"* if `"auto"`, easy-pm will install and manage SSL certificate from [Let's Encrypt](https://letsencrypt.org/) automatically.
            - **key** - *string* the path of private key
            - **cert** - *string* the path of certificate
            - **disable_redirect** - *boolean* optional. disable redirecting `http` requests to `https`. default `false`
- **webhook** - *object* optional
    - **host** - *string* address of your server
    - **token** - *string* GitHub token to access GitHub API
- **apps** - *[object]*
    - **type** - *string* optional. can be `"node"` or `"static"`. default `"node"`
    - **name** - *string* application name
    - **port** - *number* optional. the port this application running on, the same as `env.PORT`. default a random free port
    - **root** - *string* optional. root path for the static server in static mode. default `"./"`
    - **gzip** - *boolean* optional. whether enable gzip for this application. default `true`
    - **domains** - *[string]* optional. domains to access this application
    - **repository** - *string* git address of this application
    - **branch** - *string* branch to work on. default `"master"`
    - **max_memory_restart** - *string* optional. maximum memory over which the application will be restarted, ends with "K", "M" or "G"
    - **env** - *object* optional. environment variables for this application

## CLI

```
$ easy-pm -h

  Usage: easy-pm [options] [command]


  Commands:

    start <file>  start service with config file
    stop <file>   stop service with config file
    list          list running applications

  Options:

    -h, --help     output usage information
    -V, --version  output the version number
```

## TODO

- Tests
- Hot Reloading
- Multi-core
- Travis CI
- NVM

## License

MIT