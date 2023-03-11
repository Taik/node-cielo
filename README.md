# NodeJS Interface for Cielo Thermostats

by Ryan Froese

[![mit license](https://badgen.net/badge/license/MIT/red)](https://github.com/isaac-webb/node-mrcool/blob/master/LICENSE)
[![npm](https://badgen.net/npm/v/node-mrcool)](https://www.npmjs.com/package/node-mrcool)
[![npm](https://badgen.net/npm/dt/node-mrcool)](https://www.npmjs.com/package/node-mrcool)

## Overview

This interface facilitates communication with AC equipment that is connected to
the internet by SmartCielo. This was specifically adapted to facilitate
automation of the Cielo thermostats after some API changes broke other's implementations.

### Attribution

The vast majority of this code is either directly from or largely based on the
[`node-smartcielo`](https://github.com/nicholasrobinson/node-smartcielo) package
by [Nicholas Robinson](https://github.com/nicholasrobinson) and [`node-mrCool`](https://github.com/isaac-webb/node-mrcool). I forked the repo from [Isaac Webb](https://github.com/isaac-webb),
updated/fixed the issues that prevented the package from working, and
republished it.

## Installation

```bash
$ npm install node-mrcool
```

## Usage

### Sample Code Execution

```bash
$ git clone https://github.com/ryanfroese/node-cielo.git
$ cd node-cielo
$ npm install
$ node demo.js -u <username> -p <password> -i <ip_address> -m <mac_address_thermostat> -v
```

## References

- [MrCool](https://www.mrcool.com/)
- [SmartCielo](https://home.cielowigle.com/)

## Notes

- The `-v` option will send all communications via an HTTP proxy running on
  `localhost:8888` for debugging.

This is my first attempt at publishging to NPM & GitHub, so reach out with issues and I'll do my best to respond.

Good Luck,

Ryan Froese
