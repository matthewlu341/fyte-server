const { image_search } = require('duckduckgo-images-api');

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

    //seeing how it works with previous events:
    // let scheduled = doc.json().sections.filter(section => { 
    //     return (section.title==='Past events')
    // })
    // let upcoming = scheduled[0].tables[0]
    // let next = upcoming[0]
    

    let doc2 = await wtf.fetch(next.Event.links[0].page)
    let eventDate = doc2.json().sections[0].infoboxes[0].date.text; //get event date 
    let currentDate = new Date().toDateString();
    let daysUntilEvent = (currentDateToObject(currentDate).getTime()-eventDateToObject(eventDate).getTime())/86400000;
    if (daysUntilEvent<0){
        daysUntilEvent = daysUntilEvent*-1;
    }
                        
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
    return {name: next.Event.links[0].page, picture: await getEventPic(next.Event.text), fights:fightObjs, countdown: daysUntilEvent};
}
async function getEventPic(event){
    let results = await image_search({query: `${event} poster`, iterations: 1})
    return( results[0].image);
}
function monthToNumber(month){
    let months = {
        'January': 0,
        'February': 1,
        'March': 2,
        'April': 3,
        'May': 4,
        'June': 5,
        'July': 6,
        'August': 7,
        'September': 8,
        'October': 9,
        'November': 10,
        'December': 11
    }
    for (let key of Object.keys(months)){
        if (key.includes(month)){
            return months[key];
        }
    }
}
function currentDateToObject(currentDate){
    let day, month,  year;
    let temp = currentDate.split(' ');
    month = monthToNumber(temp[1]);
    day = parseInt(temp[2], 10);
    year = parseInt(temp[3], 10);
    return new Date(year, month, day)

}
function eventDateToObject(eventDate){
    let tempString = eventDate.replace(',', '');
    let temp =  tempString.split(' ');
    month = monthToNumber(temp[0]);
    day = parseInt(temp[1], 10);
    year = parseInt(temp[2], 10);
    return new Date(year, month, day)

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

app.post('/placebets', (req,res) => {
    let eventName = req.body.eventName,
    picks = req.body.picks,
    user = req.body.user;
    let client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: {
          rejectUnauthorized: false
        }
    });
    console.log(user, eventName, picks)
    client.connect()
        .then(()=> client.query(`UPDATE users SET last_event='${eventName}', picks='{${picks}}', total = total + ${picks.length} 
        WHERE username='${user}'`))
        .then((data)=>res.json(data))
        .catch(err=>console.log(err))
        .finally(() => client.end())

})

app.post('/hasuserbet', (req,res) => {
    let user = req.body.user;
    let client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: {
          rejectUnauthorized: false
        }
    });
    return client.connect()
        .then(()=>client.query(`SELECT * FROM users where username='${user}'`))
        .then(data=>res.json(data.rows[0].picks))
        .catch(err=>console.log(err))
        .finally(() => client.end())
})

app.post('/comparebets', (req,res) => {
    let currentDate = req.body.currentDate, user= req.body.user, lastEvent; //curent date from frontend
    let client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: {
          rejectUnauthorized: false
        }
    });
    client.connect() //Get the user's last event
        .then(()=>client.query(`SELECT last_event FROM users where username='${user}'`))
        .then(data=>{
            lastEvent = data.rows[0].last_event;
            if(lastEvent){
                wtf.fetch(lastEvent)
                    .then(eventPage=>{
                        let eventDate = eventPage.json().sections[0].infoboxes[0].date.text; //get event date from db
                        let daysAfterEvent = (currentDateToObject(currentDate).getTime()-eventDateToObject(eventDate).getTime())/86400000;
                        if (daysAfterEvent>=2){
                            client.query(`SELECT picks from USERS where username='${user}'`)
                                .then(data=>{
                                    let dbPicks = data.rows[0].picks; //picks in user db

                                    let eventWinners = eventPage.json().sections.filter(section => section.title==='Results')[0].templates
                                                        .filter(template=> template.template==='mmaevent bout')
                                                        .map(fight => fight.list[1]) //event winners
                                    let correctPicks = eventWinners.filter(fighter => dbPicks.includes(fighter)) //create correct pick array

                                    client.query(`UPDATE users SET correct = correct + ${correctPicks.length} WHERE username='${user}'`) //increment correct picks
                                    client.query(`UPDATE users set last_event=null, picks=null WHERE username='${user}'`) // clear last event and picks  
                                    res.json('success')    
                            })
                        } else{
                            res.json('event hasnt happened yet')
                        }
                        
                    })
            } else{
                res.json('last event null')
            }
        })
})

app.post('/getscore', (req,res) => {
    let user = req.body.user;
    let client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: {
          rejectUnauthorized: false
        }
    });
    client.connect()
        .then(()=>client.query(`SELECT correct, total from users where username='${user}'`))
            .then(data=>res.json({correct:data.rows[0].correct, total: data.rows[0].total}))
        .catch(err=>console.log(err))
        .finally(()=>client.end())
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