var http = require('http'),
    fs = require("fs"),
    util = require('util'),
    conf = require('nconf'),   
    redis = require('redis'),
    client= redis.createClient(),
    express = require('express'),
    request = require('request'),
    app = express(),
    webserver = http.createServer(app);

var lastLookup = Date.now(),
    sentLowNotice = false,
    pauseUntil = 0,
    hitCount=0,
    missCount=0,
    rateRemaining=-1;

var url = 'https://api.github.com/',
   userAgent = 'github.com/arscan/github-api-throttled';

  
conf.env().argv().file({file: __dirname + "/config.json"}).defaults({
    'GITHUB_API_WAIT_FOR': 5000,
    'PORT': '8080',
});

app.get("/users/:user", function(req,res){
    reqHandler("users/" + req.params.user, res, ['location']);
});

app.get("/repos/:user/:repo", function(req,res){
    reqHandler("repos/" + req.params.user + "/" + req.params.repo, res, ['size', 'stargazers_count', 'language']);
});


function reqHandler(entity, res, filter){
    /* check to see if the entity is in the cache */

    client.hget("github_throttled", entity, function(err, obj){
        if(obj){
            console.log("found " + entity + ": " + obj);
            res.send(JSON.stringify(obj));
        } else {
            /* not in the cache, see if I can make the call yet */
            if(Date.now() - parseInt(conf.get("GITHUB_API_WAIT_FOR"),10) > lastLookup) {
                console.log("Remaining: " + rateRemaining + " CacheHits: " + hitCount + " Ignored: " + missCount + " Looking Up: " + entity);
                hitCount = 0; missCount = 0;
                callApi(entity, res, filter);
                lastLookup = Date.now();
            } else {
                missCount++;
                res.send("{}");
            }
        }
    });

};

function callApi(entity, res, filter){
    var requestOpts = {};

    if(Date.now() < pauseUntil){
        res.send({message: "Over limit"});
        return;
    }


    requestOpts.url = url + entity;

    requestOpts.headers = {
        "User-Agent": userAgent,
        "Accept": "application/vnd.github.v3+json"
    };

    if(conf.get('GITHUB_TOKEN') !== undefined){
        requestOpts.auth = {
            user: conf.get('GITHUB_TOKEN'),
            pass: "x-oauth-basic",
            sendImmediately: true
        }

    } else if(conf.get('GITHUB_USERNAME') !== undefined && conf.get('GITHUB_PASSWORD') !== undefined){
        requestOpts.auth = {
            user: conf.get('GITHUB_USERNAME'),
            pass: conf.get('GITHUB_PASSWORD'),
            sendImmediately: true
        }
    }

    request(requestOpts,function(error, response, body){

        rateRemaining = parseInt(response.headers['x-ratelimit-remaining'], 10),
        rateReset = parseInt(response.headers['x-ratelimit-reset'], 10);

        if(rateRemaining <= 60 ){
            if(!sentLowNotice){
                console.log("Github-timeline-stream: You have only " + rateRemaining + " requests remaining, you probably should authenticate.  See Readme");
                sentLowNotice = true;
            }
        } 

        if (rateRemaining < 1){
            console.log("Github-timeline-stream: You have exhausted your requests.  Consider authenticating");
            pauseUntil = parseInt(response.headers['x-ratelimit-reset'], 10);
        }

        var ret = {};
        var body = JSON.parse(body);

        for(var i = 0; i<filter.length; i++){
            ret[filter[i]] = body[filter[i]];
        }

        client.hset("github_throttled", entity, JSON.stringify(ret));
    
        res.send(ret);

    });
}

app.listen(conf.get('PORT'));
console.log('started on ' + conf.get('PORT'));
