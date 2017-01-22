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

```bash
$ easy-pm start config.json
```

Basic example:

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

## Configuration File

- **root** - *string* The directory to put your applications.
- **port** - *number* optional. The port easy-pm running on. Default `80`.
- **gzip** - *boolean* optional. Whether enable gzip for all applications. Default `true`.
- **ssl** - *object* optional.
    - **port** - *number* optional. The SSL port easy-pm running on. Default `443`.
    - **disable_redirect** - *boolean* optional. Disable redirecting `http` requests to `https` for all sites. Default `false`.
    - **sites** - *object*.
        - **[domain]** - *object* | *"auto"* If `"auto"`, easy-pm will install and manage SSL certificate from [Let's Encrypt](https://letsencrypt.org/) automatically.
            - **key** - *string* The path of private key.
            - **cert** - *string* The path of certificate.
            - **disable_redirect** - *boolean* optional. Disable redirecting `http` requests to `https`. Default `false`.
- **webhook** - *object* optional.
    - **host** - *string* Address of your server.
    - **token** - *string* GitHub token to access GitHub API.
- **apps** - *[object]* check out [Application Configuration](#application-configuration) for available attributes.

### Application Configuration

#### Common

- **type** - *string* optional. Can be ["node"](#node), ["static"](#static) or ["custom"](#custom). Default `"node"`.
- **name** - *string* Application name.
- **port** - *number* optional. The port on which your application to run, passed to your application as `env.PORT`. Default a random free port.
- **gzip** - *boolean* optional. Whether enable gzip for this application. Default `true`.
- **domains** - *[string]* optional. Domains to access this application.
- **repository** - *string* Git address of this application.
- **branch** - *string* Branch to work on. Default `"master"`.
- **max_memory_restart** - *string* optional. Maximum memory over which the application will be restarted, ends with "K", "M" or "G".
- **env** - *object* optional. Environment variables for this application.

#### Node

In node mode, easy-pm will `npm start` your application.

#### Static

In static mode, easy-pm will run a static server to serve your application.

- **root** - *string* optional. Root path for the static server. Default `"./"`.
- **404** - *string* optional. The file to return when resource not found with status 404. Default `"404.html"`.
- **fallback** - *string* optional. Similar to `404`, but returns status 200. Used for some single page applications.

### Custom

In custom mode, you can run other non-Node.js project and custom your scripts.

- **script** - *string* Path of file to execute.
- **args** - *[string]* optional. Arguments to pass to the script.
- **interpreter** - *string* The interpreter to execute the script.
- **interpreterArgs** - *[string]* optional. Arguments to pass to the interpreter.

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