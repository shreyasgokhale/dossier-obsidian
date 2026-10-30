// The pinned bridge uses only these standard path operations. Node-compatible
// builtins avoid requiring a second package registry at build or runtime.
export { basename, dirname, extname, format, isAbsolute, join, normalize, parse, relative, resolve, sep as SEPARATOR } from "node:path";
