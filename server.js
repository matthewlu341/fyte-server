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

    let doc2 = await wtf.fetch(next.Event.text)
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
                            f1: {name: fight.list[1], record: await getRecord(fight.list[1])}, 
                            f2: {name:fight.list[3], record: await getRecord(fight.list[3])}  
            })
        }
    }
    return {name: next.Event.text, fights:fightObjs};
}

async function getRecord(fighter){
    let doc = await wtf.fetch(fighter)
    let sec;
    if(doc){ //If there's some wiki page
        sec = doc.json().sections.filter(section => {
            return (section.title==='Mixed martial arts record') //Try to find the mma record section
        })
    } else{ //no wiki page
        return('No record.')
    }  
    
    if (sec.length>0){ //doc is the fighter's page
            if(sec[0].templates[0].hasOwnProperty('data')){
                return(sec[0].templates[0].data[0].record) //straight record
            } else{
                return methodsToString((sec[0].templates[0])) //methods record
            }

    } else{ //not a fighter page
        let doc = await wtf.fetch(`${fighter} (fighter)`) //fetch the fighters name with the extra word
        let sec;
        if(doc){
            sec = doc.json().sections.filter(section => {
                return (section.title==='Mixed martial arts record') //find the mma record section
            })
        }
        if (sec.length > 0){
            if(sec[0].templates[0].hasOwnProperty('data')){
                return(sec[0].templates[0].data[0].record)
            } else{
                return methodsToString((sec[0].templates[0]))
            }
        } else{
            return ('No record.')
        }
    }
}

function methodsToString(methods){
    delete methods.template;
    let wins=0, losses =0;
    for (let method in methods){
        if(method.includes('wins')){
            wins += parseInt(methods[method])
        } else{
            losses += parseInt(methods[method])
        }
    }
    return `${wins}-${losses}`
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