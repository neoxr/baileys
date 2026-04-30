# depseek
> Seeks for dependency references in JS/TS code

[![lcov](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fgithub.com%2Fantongolub%2Fmisc%2Freleases%2Fdownload%2Flcov%2Flcov-sum.json&query=%24.scopes.packages_dep_depseek.max&label=lcov&color=brightgreen)](https://github.com/antongolub/misc/releases/download/lcov/lcov.info)
[![npm](https://img.shields.io/npm/v/depseek.svg?&color=white)](https://www.npmjs.com/package/depseek)

## Motivation
Dep extraction is a common task for many tools solved in different ways from regexps to AST parsing.
This implementation relies on streams to make controllable memory consumption.

## Status
Working draft

## Key features
* Uses stream-based reader
* Points exact dependency references by offset
* Handles string literal and comments
* Captures bound comments (optional)

## Usage
```shell
npm i depseek
```

## Usage
```js
import fs from 'fs'
import {depseek} from 'depseek'

const stream = fs.createReadStream('index.js')
const deps = await depseek(stream)

// returns
[
  { type: 'dep', value: 'node:fs', index: 17 },
  { type: 'dep', value: 'foo', index: 34 },
  { type: 'dep', value: 'q', index: 92 }
  // ...
]
```
### Options
By default `depseek` extracts only `require` and `import` arguments. You can also capture bound comments.
```ts
const depsAndComments = await depseek(stream, {comments: true})

[
  { type: 'dep', value: 'node:fs', index: 17 },
  { type: 'dep', value: 'foo', index: 34 },
  { type: 'comment', value: ' @1.0.0', index: 46 }
  //...
]
```
Stream buffer size set to `1000` by default. You can change the limit by passing `bufferSize`.
```ts
const deps = await depseek(stream, {bufferSize: 10000})
```

### Sync
Streams are aimed at intensive bulk operations. If you need to process just a few files, you can use `depseekSync`.
```ts
import fs from 'node:fs'
import { depseekSync } from 'depseek'

const contents = fs.readFileSync('index.js', 'utf8') // Buffer or string
const deps = depseekSync(contents)
```

### `patchRefs`
The one more utility is `patchRefs` that replaces dependency references with a given value.
```ts
import {patchRefs} from 'depseek'

const patcher = (v: string) => v.startsWith('.') ? v + '.js' : v
const input = `
import {foo} from './foo'
import {bar} from "./bar"
import {baz} from 'baz'
`

patchRefs(input, patcher)
// gives as a result:
`
import {foo} from './foo.js'
import {bar} from "./bar.js"
import {baz} from 'baz'
`
```

## Refs
* [browserify/module-deps](https://github.com/browserify/module-deps)
* [browserify/detective](https://github.com/browserify/detective)
* [babel/parser](https://github.com/babel/babel/tree/main/packages/babel-parser)
* [Joris-van-der-Wel/node-module-references](https://github.com/Joris-van-der-Wel/node-module-references#readme)

## License
[MIT](./LICENSE)
