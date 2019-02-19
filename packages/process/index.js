// child process to run given lambda server
const path = require("path"),
      http = require("http"),
      url = require("url"),
      //handlers = require("./handlers"),
      Youch = require('youch'),
      express = require('express')
const FETCH = require('node-fetch')
const debug = require('debug')('core')

const GLOBALS = require("./globals")

const session = require('zero-express-session')

const vm = require('vm')
var BASEPATH, ENTRYFILE, LAMBDATYPE, SERVERADDRESS, BUNDLEPATH, HANDLER


module.exports = (handler, basePath, entryFile, lambdaType, serverAddress, BundlePath, embedded) =>{
  if (!basePath && basePath!=="") throw new Error("No basePath provided.")
  if (!entryFile) throw new Error("No entry file provided.")
  if (!lambdaType) throw new Error("No lambda type provided.")
  if (!serverAddress) throw new Error("Server address not provided.")
  if (!BundlePath) throw new Error("Lambda ID not provided.")
  BASEPATH = basePath
  ENTRYFILE = entryFile
  LAMBDATYPE = lambdaType
  SERVERADDRESS = serverAddress
  BUNDLEPATH = BundlePath
  debug("Server Address", SERVERADDRESS, "BundlePath", BUNDLEPATH)
  if (embedded){
    handler(req, res)
  }
  else{
    startServer().then((port)=>{
      if (process.send) process.send(port)
      else console.log("PORT", port)
    })
  }
  
}

function generateFetch(req){
  return function fetch(uri, options){
    // fix relative path when running on server side.
    if (uri && uri.indexOf("://")===-1){

      // TODO: figure out what happens when each lambda is running on multiple servers.
      // TODO: figure out how to forward cookies (idea: run getInitialProps in a VM with modified global.fetch that has 'req' access and thus to cookies too)

      // see if it's a path from root of server
      if (uri.startsWith("/")){
        uri = url.resolve(SERVERADDRESS, uri)
      }
      // // it's a relative path from current address
      // else{
      //   // if the fetch() is called from /blog/index.jsx the relative path ('holiday') should
      //   // become /blog/holiday and not /holiday
      //   // But if the caller file is /blog.jsx, it should become /holiday
      //   var isDirectory = path.basename(ENTRYFILE).toLowerCase().startsWith("index.")
      //   uri = path.join(req.originalUrl, isDirectory?"":"../", uri)
      //   uri = url.resolve(SERVERADDRESS, uri)
      // }
    }

    if (options && options.credentials && options.credentials === 'include'){
      options.headers = req.headers
    }
    debug("paths",req.originalUrl, req.baseUrl, req.path)
    debug("fetching", uri, options, SERVERADDRESS)
    return FETCH(uri, options)
  }
}

function startServer(){
  return new Promise((resolve, reject)=>{
    
    const app = express()

    // bootstrap express app with session
    session(app)

    app.use(require('body-parser').urlencoded({ extended: true }));
    app.use(require('body-parser').json());

    app.all("*"/*[BASEPATH, path.join(BASEPATH, "/*")]*/, handleRequest)
  
    var listener = app.listen(0, "127.0.0.1", () => {
      debug("listening ", LAMBDATYPE, listener.address().port)
      resolve(listener.address().port)
    })
  })
}

function handleRequest(req, res){
  const file = path.resolve(ENTRYFILE)
  // if path has params (like /user/:id/:comment). Split the params into an array.
  // also remove empty params (caused by path ending with slash)
  if (req.params && req.params[0]){
    req.params = req.params[0].replace(BASEPATH.slice(1), "").split("/").filter((param)=> !!param)
  }
  else{
    delete req.params
  }
  try{
    var globals = Object.assign({__Zero: {HANDLER, BASEPATH, req, res, LAMBDATYPE, BUNDLEPATH, ENTRYFILE, renderError, fetch: generateFetch(req)}}, GLOBALS);

    vm.runInNewContext(`
      const { HANDLER, req, res, LAMBDATYPE, BASEPATH, ENTRYFILE, fetch, renderError, BUNDLEPATH } = __Zero;
      global.fetch = fetch
      // process.on('unhandledRejection', (reason, p) => {
      //   renderError(reason, req, res)
      // })

      HANDLER(req, res, ENTRYFILE, BUNDLEPATH, BASEPATH)
    `, globals)
  }
  catch(error){
    renderError(error, req, res)
  }
}

async function renderError(error, req, res){
  const youch = new Youch(error, req)
      
  var html = await 
  youch.addLink(({ message }) => {
    var style = `text-decoration: none; border: 1px solid #dcdcdc; padding: 9px 12px;`
    const urlStack = `https://stackoverflow.com/search?q=${encodeURIComponent(`${message}`)}`
    const urlGoogle = `https://www.google.com/search?q=${encodeURIComponent(`${message}`)}`
    return `
    <a style="${style}" href="${urlGoogle}" target="_blank" title="Search on Google">Search Google</a>
    <a style="${style}" href="${urlStack}" target="_blank" title="Search on StackOverflow">Search StackOverflow</a>
    
    `
  }).toHTML()
  res.writeHead(200, {'content-type': 'text/html'})
  res.write(html)
  res.end()
}