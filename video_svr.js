"use strict";
const path = require('path');
const fs = require('fs');
const async = require('async');
const clone = require('clone');
const archiver =  require('archiver');
const nodemailer = require('nodemailer');
const http = require('http');
const recursive = require('recursive-readdir');
const request = require('request');
const moment = require('moment');
const mv = require('mv');

var exports = module.exports = {};

// globals
const LL = process.env.LL || process.env.npm_package_config_ll || 'warning';
const PORT = process.env.PORT || process.env.npm_package_config_port || '3003';
const PORT_DB = process.env.PORT_DB || process.env.npm_package_config_port_db || '3002';
const IP_DB = process.env.IP_DB || process.env.npm_package_config_ip_db || '192.168.0.21';
const DIR_VIDEO_MOVEMENT_STORAGE = process.env.DIR_VIDEO_MOVEMENT_STORAGE || '/video-movement';
const DIR_VIDEO_STORAGE = process.env.DIR_VIDEO_STORAGE || '/video-files';


// --------------------
// logger
// --------------------
const winston = require('winston');
var logger = new (winston.Logger)({
  transports: [
    new (winston.transports.Console)({'timestamp':true, level: LL })
   ]
});

logger.debug('port: ' + PORT);
logger.debug('log level: ' + LL);

// db server url - this assumes that we are on the
// same host
const URL_DB = 'http://' + IP_DB + ':' + PORT_DB;

// ----------------------------------------
// createMovementDir(): check for video 
// movement storage dir, create it if
// it doesn't exist
// ----------------------------------------
function createMovementDir(callback) {
  fs.stat(DIR_VIDEO_MOVEMENT_STORAGE, function(err, fileStat) {
      if (err) {
        if (err.code == 'ENOENT') {
          logger.warn('Does not exist.');
          fs.mkdir(DIR_VIDEO_MOVEMENT_STORAGE, function(err){
            callback(err);
          });
        } else {
          callback(err);
        }
      } else {
        callback();
      }
  });
}

// ----------------------------------------
// moveVideoFiles() - moves files from
// the temp storage to a smb drive.
// ----------------------------------------
function moveVideoFiles(lFiles, callback) {

  async.forEach(lFiles, function(file, callb) {
    var dest = path.join(DIR_VIDEO_MOVEMENT_STORAGE,path.basename(file));
    logger.debug(file, dest);
    mv(file, dest, callb);
  }, function(err) {
    callback(err);
  });
}


// ----------------------------------------
// deleteVideoFiles()
// ----------------------------------------
function deleteVideoFiles(lFiles, callback) {

  async.forEach(lFiles, function(file, callb) {
    logger.debug('delete: ' + file);
    fs.unlink(file, function(err) {
      callb(err);
    });
  }, function(err) {
    callback(err);
  });
}

// ----------------------------------------
// storeVideoMovement()
// ----------------------------------------
function storeVideoMovement(lFiles, callback) {

  async.forEach(lFiles, function(file, callb) {
    logger.debug('delete: ' + file.file);
    fs.unlink(file.file, function(err) {
      callb(err);
    });
  }, function(err) {
    callback(err);
  });
}

// -----------------------------------------------------
// identifyVideosWithMovement() 
//
//    - matches stored video with movement timestamps.
//
// -----------------------------------------------------
function identifyVideosWithMovement(movements, fProcessMpegs, callback) {
  if (typeof callback === 'undefined') {
    callback = fProcessMpegs;
    fProcessMpegs = false;
  }
  var lFileCTime = [];
  var lFilesVideo = [];
  var lFilesToDelete = [];
  var lFilesToMove = [];
  var lDbRecsToUpdate = [];
 
  // ------------------------------------
  // function to map movement timestamps
  // with file start times
  // ------------------------------------
  function mapFilesToMovement(start, stop) {
    return movements.filter(function(a) {
      var b = new Date(a.movement_date);
      return (b >= start && b < stop);
    });
   
  }

  // video files - need at least 3 to get an interval
  // since the latest file is partial
  async.series([
    function(cb) {
      // video files - read these in
      fs.readdir(DIR_VIDEO_STORAGE, function(err, items) {
        if (items.length < 3) {
          var msg = 'need at least 2 files, otherwise the video file will be incomplete';
          logger.warn(msg);
          callback(msg);
          cb(msg);
        } else {
          lFilesVideo = items;
          cb();
        }
      });
    },
    // video files - get timestamps
    function(cb) {
      for (var i=0; i<lFilesVideo.length; i++) {
        var tFile = path.join(DIR_VIDEO_STORAGE, lFilesVideo[i]);
        var tRec = {};
        tRec.file = tFile;
        tRec.ctime = fs.statSync(tFile).ctime;
        lFileCTime.push(tRec);
        if (i == lFilesVideo.length - 1) {
          cb();
        }
      }
    },
    // db entries - map them to video files
    function(cb) {
      var lMappedFiles = [];
      var start = null;
      var stop = null;
      for (var i=0; i<lFileCTime.length-1; i++) {
        // date - get it from the file name
        var tmp = path.basename(lFileCTime[i].file).match(/(\d{4}-\d{2}-\d{2})-(\d{2}:\d{2}:\d{2})/);
        start = new Date(tmp[1] + ' ' + tmp[2]);
        stop = lFileCTime[i].ctime;
        logger.debug(lFileCTime[i].file, start, stop);
        lMappedFiles = [];
        lMappedFiles = mapFilesToMovement(start, stop);
        if (lMappedFiles.length > 0) {
          lFileCTime[i].movement = lMappedFiles;
        }
      }
      cb();
    },
    function(cb) {
      // mpegs - move them to samba drive and update the database
      if (fProcessMpegs === true) {
        async.forEach(lFileCTime, function(rec, callb) {
          //console.log(rec);
          if ('movement' in rec) {
            lFilesToMove.push(rec.file);
            lDbRecsToUpdate = lDbRecsToUpdate.concat(rec.movement);
            callb();
          } else {
            // no movement - delete these
            lFilesToDelete.push(rec.file);
            callb();
          }
        }, function(err) {
          if (err) {
            logger.error(err);
            cb(err);
            callback(err);
          } else {
            cb();
          }
        });
      } else {
        cb();
      }
    },
    function(cb) {
      // put processing
      if (fProcessMpegs === true) {
        deleteVideoFiles(lFilesToDelete, 
          function(err) {
            if (err) {
              logger.error(err);
            }
        });
        moveVideoFiles(lFilesToMove, function(err){
          logger.info(lDbRecsToUpdate);
          updateToProcessed(lDbRecsToUpdate, callback);
          cb();
        });
      // get processing
      } else {
        callback(null, lFileCTime);
        cb();
      }
    },
  ]);
}

// ----------------------------------------------------------
// getToBeProcessed() 
//
//    - gets movement
//      records from the database.
//    - db-svr - get movements that need to be
//        processed (i.e. move the video with 
//        movement to a storage location and
//        mark the movements "processed" in the
//        database.)
// ----------------------------------------------------------
function getToBeProcessed(callback) {
  var url = URL_DB + '/db/unprocessed';
  logger.debug(url);
  request.get(
    url,
    function (error, response, body) {
      if (error || response.statusCode != 200) {
          logger.error(response);
        callback(error);
      } else {
        callback(error, JSON.parse(body));
      }
  });
}

// ----------------------------------------------------------
// updateToProcessed() 
//
//  - updates the db image record to "processed"
//
// ----------------------------------------------------------
function updateToProcessed(lRecs, callback) {
  var url = URL_DB + '/db/processed';
  logger.debug(url);
  request({
    method: 'put',
    url: url,
    json: lRecs,
  }, function(error, response, body) { 
      if (error || response.statusCode != 200) {
          logger.error(response);
        callback(error);
      } else {
        callback();
      }
  });
}

// --------------------------------------------------
//
// web app - video 
//
//   - purpose: to put video/mp4 files with detected
//   movement into a separate 
//   dir so that they can viewed easily.
//
//   - vlc will store all video
//   on the data drive. This module's job is to
//   correlate the camera movement triggers to the 
//   stored video and move it to the movement dir.
//
// --------------------------------------------------
var server = http.createServer(requestProcess);

function requestProcess(request, response) {
  var headers = request.headers;
  var method = request.method;
  var url = request.url;
  var body = [];
  var valRet = {};
  var data = null;

  response.statusCode = 200;
  request.on('error', function(err) {
    logger.error(err);
    valRet.text = err;
  }).on('data', function(chunk) {
    body.push(chunk);
  }).on('end', function() {
    body = Buffer.concat(body);
    response.on('error', function(err) {
      logger.error(err);
      valRet.text = err;
    });
    let tmpReq = 'Message received: ' + url;

    async.series([
      // directory - create it if it doesn't exist
      function(cb) {
        createMovementDir(function(err) {
          cb(err);
        });
      },
      function(cb) {
        // video request - return the movement
        if (url == '/video/movement' &&  method == 'GET') {
          logger.debug('Video movement check');
          getToBeProcessed(function(err, res) {
            if (err) {
              logger.error(err);
              response.statusCode = 500;
              return cb();
            } else {
              var lMovemnent = res.data.query;
              identifyVideosWithMovement(
                lMovemnent, function(err, res) {
                  //if (err) return cb(err);
                  logger.debug(JSON.stringify(res, null, 2));
                  valRet.update = res;
                  cb();
              });
            }
          });
        // image store
        } else if (url == '/video-files' &&  method == 'POST') {
          logger.debug('Video post');
          logger.debug(DIR_VIDEO_STORAGE);
          if (fs.existsSync(DIR_VIDEO_STORAGE)) {
            logger.info(fs.readdirSync(DIR_VIDEO_STORAGE));
          }
          cb();
        // video files list
        } else if (url == '/video-files' &&  method == 'GET') {
          logger.debug('Video files - list them');
          logger.debug(DIR_VIDEO_STORAGE);
          if (fs.existsSync(DIR_VIDEO_STORAGE)) {
            logger.info(fs.readdirSync(DIR_VIDEO_STORAGE));
          }
          cb();
        // video movement - save and clean  
        } else if (url == '/video/movement/process' &&  method == 'PUT') {
          logger.debug('Video move and cleanup');
          getToBeProcessed(function(err, res) {
            if (err) {
              logger.error(err);
              response.statusCode = 500;
              return cb();
            } else {
              var lMovemnent = res.data.query;
              identifyVideosWithMovement(
                lMovemnent, true, function(err, res) {
                  cb();
              });
            }
          });
        // delete request
        } else if (url == '/video' &&  method == 'DELETE') {
          logger.debug('Delete video file');
          data = JSON.parse(body);
          deleteVideoFiles(data, function(err) {
            if (err) {
              response.statusCode = 400;
            } else {
              response.statusCode = 204;
            }
            cb();
          });
        } else {
          logger.warn('Unrecognized request: %s', tmpReq);
          response.statusCode = 404;
          cb();
        }
      },
      // http response
      function(cb) {
        response.setHeader('Content-Type', 'application/json');
        valRet.status = response.statusCode;
    
        var responseBody = {
          method: method,
          data: valRet,
          url: url,
        };
    
        response.write(JSON.stringify(responseBody));
        response.end();
        cb();
      },
    ]);
  });
}

// ------------------------------------
//  main loop - service
// ------------------------------------
server.listen(PORT);
