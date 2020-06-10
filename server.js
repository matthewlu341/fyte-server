let express = require('express'),
bp = require('body-parser'),
cors = require('cors'),
path = require('path'),
puppeteer = require('puppeteer'),
forbidden = ['https://sportsurge.net/','https://policies.google.com/privacy', 'https://policies.google.com/terms', 'https://sportsurge.net/',
                'https://sportsurge.net/#/login'];

app = express();
app.use(express.static(path.join(__dirname, 'client/build')));
app.use(bp.json());
app.use(cors());
// process.env.PORT || 
app.listen ( process.env.PORT || 3001, ()=>{
    console.log(`running`)
})

async function scrape(){
    let browser = await puppeteer.launch(),
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
        return allStreams;
    }
    await browser.close(); //check this out
}

app.get('/', (req, res) => {
    res.status(200).json('root loaded')
})

app.get('/tweets', (req, res)=>{
        var Twit = require('twit')
        var T = new Twit({
        consumer_key:         's5TtlAgj746Spby4Nx7DOryyU',
        consumer_secret:      'Sw68vQWuPuHcBKAGnK17DJxDMduQu6pjBybYG6as1lNTBolsxo',
        access_token:         '2991041913-lQt07ijIbgF9FhWWJkIKAe7wrqdNhz3KteLy5R3',
        access_token_secret:  'UGpPNqWm9xupXC15huQmyd7NWADxVPglfC8Hlo3BD10Vz',
        strictSSL:            true,     // optional - requires SSL certificates to be valid.
        })
        var data = T.get('statuses/user_timeline', { user_id: '	6446742' }, (err,data,response) => {
            res.status(200).json(data)
        })
})

app.get('/streams', (req,res) => {
    scrape().then(response => {res.json(response)});
})

