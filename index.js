var http = require('http'),
    fs = require("fs"),
    util = require('util'),
    conf = require('nconf'),   
    express = require('express'),
    request = require('request'),
    app = express(),
    webserver = http.createServer(app);

var entities = {},
    lastLookup = Date.now(),
    sentLowNotice = false,
    pauseUntil = 0,
    hitCount=0,
    missCount=0,
    rateRemaining=-1;

var CACHE_FILENAME = "entities_cache.json",
   url = 'https://api.github.com/',
   userAgent = 'github.com/arscan/github-api-throttled';

  
conf.env().argv().file({file: __dirname + "/config.json"}).defaults({
    'GITHUB_API_WAIT_FOR': 5000,
    'GITHUB_PORT': '8080'
});

if(fs.existsSync(__dirname + "/" + CACHE_FILENAME)){
    entities = JSON.parse(fs.readFileSync(__dirname + "/" + CACHE_FILENAME, 'utf8'));
}

app.get("/users/:user", function(req,res){
    reqHandler("users/" + req.params.user, res, ['location']);
});

app.get("/repos/:user/:repo", function(req,res){
    reqHandler("repos/" + req.params.user + "/" + req.params.repo, res, ['size', 'stargazers_count', 'language']);
});


function reqHandler(entity, res, filter){
    /* check to see if the entity is in the cache */

    if(entities[entity]){
        hitCount++;
        res.send(JSON.stringify(entities[entity]));
        return;
    }

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
            console.log("checking " + filter[i]);
            ret[filter[i]] = body[filter[i]];
        }

        console.log(ret);
        entities[entity] = ret;
    
        res.send(ret);

    });
}

function saveUsers(){
    fs.writeFile(__dirname + '/' + CACHE_FILENAME, JSON.stringify(entities), function(){
        console.log("_____saved entities");
    });
}

setInterval(saveUsers, 300000);

app.listen(conf.get('GITHUB_PORT'));
