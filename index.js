const axios = require('axios');
const cheerio = require('cheerio');
const isNumber = require('is-number');
const CronJob = require('cron').CronJob;

var express = require('express');
var compression = require('compression')
var app = express();
app.use(compression({ filter: shouldCompress }))
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(__dirname + '/views'));
var striptags = require('striptags');
require('dotenv').config();
const { MongoClient } = require('mongodb');

// configs 변수
const configs = {
    EXPRESS_PORT: process.env.EXPRESS_PORT || '3000',
    DB_HOST: process.env.DB_HOST || 'localhost',
    DB_PORT: process.env.DB_PORT || 3306,
    DB_USER: process.env.DB_USER || 'root',
    DB_PASS: process.env.DB_PASS || 'admin',
    connectTimeout: Number(process.env.CONNECT_TIMEOUT || 1000)
}
const client = new MongoClient(configs.DB_HOST);
var conn, db, collection_list, totalCnt;

app.use(function (req, res, next) {
    //console.log('Time:', Date.now());
    //    console.log('Request Type:', req.method);
    next();
});

app.get('/', function (req, res) {
    res.sendFile(__dirname + '/views/index.html');
});

app.post('/getAll', async function (req, res) {
    //console.log('req.body:', req.body);
    let start = req.body.start; //페이징번호
    let length = req.body.length; //몇개씩
    let draw = req.body.draw;
    let search_value = req.body["search[value]"].trim() || null;
    let _isBreak = false;
    let docs = null;
    if (!isNumber(length) || !isNumber(start)) {
        _isBreak = true;
    }
    if (_isBreak) {
        console.log("[error] value");
        res.send({
            data: {}
        });
        return;
    }

    let offset = start;
    let rows_per_page = Number(length);
    let page = (offset / rows_per_page);// + 1; // == 1
    let skip = page * rows_per_page; // == 10 for the first page, 10 for the second ...

    totalCnt = await collection_list.find().count();
    console.log("전체 저장된 갯수", totalCnt);

    let lastone = await collection_list.find({ touched: true }).sort({ _id: -1 }).limit(1).toArray();
    /**
     * 문자열 조건 검색은 개선이 필요함 
     * 데이터가 쌓이면 or 조건은 매우 느려짐
     */
    if (search_value !== null) {
        let sql_where = {};
        const wheres = search_value.split(" ");

        //두단어 이상 지원을 하기위해 조건은 or
        for (let where of wheres) {
            sql_where = Object.assign(sql_where, {
                $or: [
                    { title: { $regex: where } },
                    { content: { $regex: where } }
                ]
            }
            );
        }

        //500개 전까지꺼만 검색
        const wher = {
            $and: [
                { _id: { $gt: (lastone[0]._id - 500) } },
                { touched: true },
                sql_where
            ]
        }

        const docs = await collection_list.find(wher).sort({ "_id": -1 }).limit(rows_per_page).toArray();

        if (docs !== null) {
            ret = {
                recordsTotal: totalCnt,
                //recordsFiltered: info.doc_count,
                draw: draw,
                data: docs
            }
            result = JSON.stringify(ret);
            res.send(result);
        }
        else {
            res.send({
                data: {}
            });
            return;
        }

    } else {
        //let docs = await collection_list.find().sort({ "_id": -1 }).skip(skip).limit(rows_per_page).toArray();

        //1000개 이전거부터 오더링해서 출력
        const docs = await collection_list.find({
            $and: [
                { _id: { $gt: lastone[0]._id - 1000 } },
                { touched: true }
            ]
        }).sort({ "_id": -1 }).limit(rows_per_page).toArray();

        if (docs !== null) {
            ret = {
                recordsTotal: totalCnt,
                //recordsFiltered: info.doc_count,
                draw: draw,
                data: docs
            }
            result = JSON.stringify(ret);
            res.send(result);
        }
        else {
            res.send({
                data: {}
            });
            return;
        }
    }

});
app.listen(configs.EXPRESS_PORT, () => {
    console.log('Server is up and running');
});

//* 주소 읽고 디비에 저장
async function updateList(url) {
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);
    let datas = [];
    //async 쓰면 내부에서 await 가능
    //$('div.board-list table tbody tr').each(async (index, item) => {
    $('div.board-list table tbody tr').each((index, item) => {
        let num = $(item).find('td.num span').text();
        let title1 = $(item).find('td.tit div.text-wrap div a');
        $(title1).children('span').remove().html(); //span제거 카테고리 제거 // 제목만 뽑기위해
        let title = $(title1).text().trim();
        let href = $(item).find('td.tit div a').attr('href');
        let username = $(item).find('td.user span.layerNickName').text();
        let date = $(item).find('td.date').text();

        let data = {
            _id: Number(num),
            num: Number(num),
            date: date,
            title: title,
            name: username,
            href: href,
            touched: false
        }

        if (num !== '공지') {
            datas.push(data);
        }
    });

    //ordered:fasle 옵션으로 중복 된건 저장 안하게 
    collection_list.insertMany(datas, { ordered: false })
        //.then(console.log)
        .catch(function (error) {
            console.log(`Error worth logging: ${error}`); //E11000 duplicate key error collection 중복은 무시가능
        });
}

async function updateContent(url) {
    let docs = await collection_list.find().sort({ "_id": -1 }).limit(60).toArray();

    //console.log(docs);
    //for await (let doc of docs) {
    for (let doc of docs) {
        //console.log(doc._id);
        //가장 최근거부터 세부 게시물정보가 있는지 확인하고 업데이트하자
        if (!doc.touched) {
            console.log('[update]', doc.href);
            try {
                axios.get(encodeURI(doc.href)).then(function (response) {
                    const $ = cheerio.load(response.data);
                    let title = $('.articleTitle').html();
                    let articleDate = $('.articleDate').text();
                    let content = $('#powerbbsContent').html();

                    //태그제거
                    title = striptags(title.trim());
                    content = striptags(content.trim());

                    const filter = { _id: doc._id };
                    const options = { upsert: true };
                    //const options = {};
                    const updateDoc = {
                        $set: {
                            touched: true,
                            content: content,
                            date: articleDate
                        },
                    };
                    //const result = await collection_list.updateOne(filter, updateDoc, options);
                    collection_list.updateOne(filter, updateDoc, options)
                        //.then(console.log)
                        .catch(function (error) {
                            console.log(`Error worth logging: ${error}`);
                        });
                }).catch(error => {
                    console.error(error);
                })
            } catch (err) {
                //에러나면 터치하고 더이상 업데이트하지 않는다
                //대부분 게시물을 삭제한경우
                const filter = { _id: doc._id };
                const options = { upsert: true };
                //const options = {};
                const updateDoc = {
                    $set: {
                        touched: true,
                    },
                };
                //const result = await collection_list.updateOne(filter, updateDoc, options);
                collection_list.updateOne(filter, updateDoc, options)
                    //.then(console.log)
                    .catch(function (error) {
                        console.log(`Error worth logging: ${error}`);
                    });
            }
        }
    }
}
function cl(index, object) {
    console.log(index, typeof object, isNumber(object), object)
}
var cjob_updateContent = new CronJob('*/5 * * * * *', updateAll, null, false, 'Asia/Seoul'); //1분마다 0 * * * * *

async function updateAll() {
    console.log('[updateContent][start]', Date.now());
    //1페이지 업데이트
    //https://www.closetoya.com/1.html
    //https://www.inven.co.kr/board/diablo2/5739?category=%EC%8A%A4%ED%83%A0&p=1
    //await updateList("https://www.closetoya.com/1.html");
    await updateList("https://www.inven.co.kr/board/diablo2/5737?p=1");

    await updateContent();
    console.log('[updateContent][end]', Date.now());
}
function shouldCompress(req, res) {
    if (req.headers['x-no-compression']) {
        // don't compress responses with this request header
        return false
    }

    // fallback to standard filter function
    return compression.filter(req, res)
}
(async () => {//
    console.log(configs);
    await client.connect();
    console.log('Connected successfully to server');
    db = client.db('dia2para');
    collection_list = db.collection('list');

    totalCnt = await collection_list.find().count()
    console.log("전체 저장된 갯수", totalCnt);

    await collection_list.createIndex({ num: -1 });
    await collection_list.createIndex({ touched: 1 });

    //게시물 안에 들어가서 내용 추출
    await updateAll();
    cjob_updateContent.start();

})();
