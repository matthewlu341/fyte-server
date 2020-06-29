let express = require('express'),
bp = require('body-parser'),
cors = require('cors'),
path = require('path'),
puppeteer = require('puppeteer'),
wtf = require('wtf_wikipedia'),
forbidden = ['https://sportsurge.net/','https://policies.google.com/privacy', 'https://policies.google.com/terms', 'https://sportsurge.net/',
                'https://sportsurge.net/#/login'],
morgan = require('morgan'),
fetch = require('node-fetch'),
Scraper = require('images-scraper'),
{ Client } = require('pg');
require('dotenv').config();
let bcrypt = require('bcryptjs'),
saltRounds = 10;

app = express();
app.use(express.static(path.join(__dirname, 'client/build')));
app.use(bp.json());
app.use(cors());
app.use(morgan('tiny'))
// process.env.PORT || 

app.listen ( process.env.PORT || 3001, ()=>{
    console.log(`server running`)
})

async function scrape(groupNo){
    let browser = await puppeteer.launch({ args: ['--no-sandbox'] }),
    page = await browser.newPage();
    await page.goto(`https://sportsurge.net/#/groups/${groupNo}` , {
        waitUntil: 'networkidle0',
      });

    let streams = await page.$$('a[href]'),
    hrefs = [];

    let data = await page.$$eval('td', cells => { 
        let ret = [];
        for (let cell of cells){
            ret.push(cell.textContent)
        }
        return ret;
    })

    for (let stream of streams){
        let prop = await stream.getProperty('href');
        let href = await prop.jsonValue();
        hrefs.push(href);
    }
   
    hrefs = hrefs.filter(href => !forbidden.includes(href))
    let set = new Set(hrefs);
    hrefs = Array.from(set);

    if(hrefs.length === 0){
        await browser.close();
        return ("none")
    } else{
        let allStreams = [],
        fields = ['link','name', 'res', 'fps', 'btr', 'lang', 'cov', 'comp', 'ads']
        for (let link of hrefs){
            let stream = {};
            for (let i=0; i<fields.length; i++){
                if (i===0){
                    stream[fields[i]] = link;
                } else {
                    stream[fields[i]] = data[i-1];
                }
            }
            allStreams.push(stream)
            for (let i=0; i<11; i++){
                data.shift();
            }
        }
        await browser.close();
        return allStreams;
    }
}
async function getFights(){
    let doc = await wtf.fetch('List of ufc events')
    let scheduled = doc.json().sections.filter(section => {
        return (section.title==='Scheduled events')
    })
    let upcoming = scheduled[0].tables[0]
    let next = upcoming[upcoming.length-1]

    let doc2 = await wtf.fetch(next.Event.links[0].page)
    let fightCard = doc2.json().sections.filter(section => {return section.title==='Fight card' || section.title==='Results'})
    let fights = fightCard[0].templates;
    for (let i=0;i<2;i++){
        fights.shift();
    }
    fights.pop();
    let fightObjs=[];
    for (let fight of fights){
        if(!fight.list[0].includes('Preliminary')){
        
            fightObjs.push({division: fight.list[0], 
                            f1: {name: fight.list[1]}, 
                            f2: {name:fight.list[3]}  
            })
        }
    }
    return {name: next.Event.text, picture: await getEventPic(next.Event.text), fights:fightObjs};
}
async function getEventPic(event){
    const google = new Scraper({
        puppeteer: {
          headless: true,
        }
      });
    let results = await google.scrape(`${event} poster`, 1)
    return results;
}

app.get('/', (req, res) => {
    res.status(200).json('root loaded')
})

app.get('/tweets', (req, res)=>{
        var Twit = require('twit')
        var T = new Twit({
        consumer_key:        `${process.env.CONSUMER_KEY}`,
        consumer_secret:     `${process.env.CONSUMER_SECRET}`,
        access_token:         `${process.env.ACCESS_TOKEN}`,
        access_token_secret:  `${process.env.ACCESS_TOKEN_SECRET}`,
        strictSSL:            true,     // optional - requires SSL certificates to be valid.
        })
        var data = T.get('statuses/user_timeline', { user_id: '	6446742' }, (err,data,response) => {
            res.status(200).json(data)
        })
})

app.post('/streams', (req,res) => {
    scrape(req.body.groupNo).then(response => {res.status(200).json(response)});
})

app.get('/youtube', (req,res) => {
    fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=5&playlistId=UUvgfXK4nTYKudb0rFR6noLA&key=${process.env.GOOGLE_API_KEY}`)
        .then(response=>response.json())
        .then(data => {
            res.json(data.items)
        })
})

app.post('/signup', (req,res) => {
    let client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: {
          rejectUnauthorized: false
        }
      });
    bcrypt.hash(req.body.pass, saltRounds, function(err, hash) {
        // Store hash in password DB.
        client.connect()
        .then(()=>console.log('signup client connected'))
            .then(()=> client.query(`INSERT INTO users (username, password) VALUES ('${req.body.user}', '${hash}')`))
                .then(results => res.json(results))
                .catch(err=>res.json('user already exists'))

        .catch(err=>console.log(err))
        .finally(() => client.end())
    });
});

app.post('/signin', (req,res) => {
    let client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: {
          rejectUnauthorized: false
        }
      });
    client.connect()
        .then(()=> console.log('signin client connected'))
        .then(()=>client.query(`SELECT * FROM users WHERE username = '${req.body.user}';`)) 
        .then((results) => {
            if(results.rowCount===1){ 
                bcrypt.hash(req.body.pass, saltRounds, function(err, hash) {
                    if(bcrypt.compareSync(req.body.pass, results.rows[0].password)){
                        res.json('loggedIn') //User and pass are good
                    } else{
                        res.json('wrongPw') //Pass is wrong
                    }
                })
            } else{
                res.json('user not found') //User dne
            }
        })
        .catch(err=>console.log(err))
        .finally(()=>client.end())
})

app.get('/nextevent', (req,res)=>{
    getFights().then(response => res.json(response))

})

function notFound(req,res,next){
    const error = new Error('not found');
    res.status(404);
    next(error);
}
function errorHandler(error,req,res,next){
    res.status(res.statusCode || 500)
    res.json({
        message: error.message
    })
}
app.use(notFound);
app.use(errorHandler);