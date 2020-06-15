let express = require('express'),
bp = require('body-parser'),
cors = require('cors'),
path = require('path'),
puppeteer = require('puppeteer'),
forbidden = ['https://sportsurge.net/','https://policies.google.com/privacy', 'https://policies.google.com/terms', 'https://sportsurge.net/',
                'https://sportsurge.net/#/login'],
morgan = require('morgan'),
fetch = require('node-fetch'),
{ Client } = require('pg');
require('dotenv').config();

app = express();
app.use(express.static(path.join(__dirname, 'client/build')));
app.use(bp.json());
app.use(cors());
app.use(morgan('tiny'))
// process.env.PORT || 
app.listen ( process.env.PORT || 3001, ()=>{
    console.log(`server running`)
})

let client = new Client({
    user: 'postgres',
    password: 'postgrespassword',
    host: '127.0.0.1',
    database: 'fyte'
})

async function scrape(){
    let browser = await puppeteer.launch({ args: ['--no-sandbox'] }),
    page = await browser.newPage();
    await page.goto('https://sportsurge.net/#/groups/19' , {
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
        return ("No streams available, check back later.")
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

app.get('/streams', (req,res) => {
    scrape().then(response => {res.status(200).json(response)});
})

app.get('/youtube', (req,res) => {
    fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=5&playlistId=UUvgfXK4nTYKudb0rFR6noLA&key=${process.env.GOOGLE_API_KEY}`)
        .then(response=>response.json())
        .then(data => {
            res.json(data.items)
        })
})

app.post('/signup', (req,res) => {
    console.log(req.body.user, req.body.pass)
    client.connect()
    .then(()=>console.log('db connected'))
    .then(()=> client.query(`INSERT INTO users (username, password) VALUES ('${req.body.user}', '${req.body.pass}')`))
    .then(results => res.json(results))

    .catch(err=>console.log(err))
    .finally(() => client.end())
});

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