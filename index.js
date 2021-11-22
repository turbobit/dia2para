const axios = require('axios');
const cheerio = require('cheerio');
const isNumber = require('is-number');
const CronJob = require('cron').CronJob;

var express = require('express');
var app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(__dirname + '/views'));
var striptags = require('striptags');
require('dotenv').config();

// configs 변수
const configs = {
    EXPRESS_PORT: process.env.EXPRESS_PORT || '3000',
    DB_HOST: process.env.DB_HOST || 'localhost',
    DB_PORT: process.env.DB_PORT || 3306,
    DB_USER: process.env.DB_USER || 'root',
    DB_PASS: process.env.DB_PASS || 'admin',
    connectTimeout: Number(process.env.CONNECT_TIMEOUT || 1000)
}

var mysql = require('mysql2/promise');
var conn, totalCnt;

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
    let rows_per_page = length;
    let page = (offset / rows_per_page);// + 1; // == 1
    let skip = page * rows_per_page; // == 10 for the first page, 10 for the second ...

    const [rows] = await conn.execute('select count(*) as cnt from list');
    totalCnt = rows[0].cnt;
    //console.log("전체 저장된 갯수", totalCnt);

    if (search_value !== null) {
        let sql_where = [];
        let sql_value = [];
        const wheres = search_value.split(" ");
        for (let where of wheres) {
            sql_where.push(`
                (
                    title like ? or
                    content like ? or
                    name like ? 
                )
            `);
            sql_value.push("%" + where + "%");
            sql_value.push("%" + where + "%");
            sql_value.push("%" + where + "%");
        }
        //console.log(sql_value);
        sql_value.push(skip);
        sql_value.push(rows_per_page);
        const sql = `
            select * from list 
            where ${sql_where.join(" or ")}
            order by num desc limit ?,?        
        `;
        //console.log(sql);
        const [docs, fields] = await conn.execute(sql, sql_value);
        //console.log(docs);
        //console.log(docs.length);

        //제목과 내용 이름에서 하이라이트 기능을 키자, 검색어가 무조건 있다 고기만 자르자

        if (false) {
            for (let doc of docs) {

            }
        }
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

        const [docs, fields] = await conn.execute(`select * from list order by num desc limit ?,?`, [skip, rows_per_page]);
        //console.log(docs.length);
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
    const [rows, fields] = await conn.execute('select count(*) as cnt from list');
    totalCnt = rows[0].cnt;
    console.log("전체 저장된 갯수", totalCnt);

    const response = await axios.get(url);
    const $ = cheerio.load(response.data);
    $('div.board-list table tbody tr').each(async (index, item) => {
        let num = $(item).find('td.num span').text();
        let title1 = $(item).find('td.tit div.text-wrap div a');
        $(title1).children('span').remove().html(); //span제거 카테고리 제거 // 제목만 뽑기위해
        let title = $(title1).text().trim();
        let href = $(item).find('td.tit div a').attr('href');
        let username = $(item).find('td.user span.layerNickName').text();
        let date = $(item).find('td.date').text();

        //세부 게시물 들어가서 링크 따오자
        sql = `insert into list ( num, date_str, title, name, href) values
            ( ? , ? , ? , ? , ? ) ON DUPLICATE KEY UPDATE num = ? 
        `;
        //병렬 처리를위하 await 안씀
        //await conn.execute(sql, [num, date, title, username, href, num]);
        conn.execute(sql, [num, date, title, username, href, num]);

    });
}

async function updateContent(url) {
    const [rows, fields] = await conn.execute('select * from list order by num desc limit 20');
    for (let doc of rows) {
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

                    //console.log(title);
                    //console.log(articleDate);//작성일
                    //console.log(content);
                    //병렬 처리를위하 await 안씀
                    //await conn.execute(sql, [num, date, title, username, href, num]);
                    sql = `insert into list ( num ) values ( ? ) ON DUPLICATE KEY UPDATE touched = 1, date = ?, content = ?`;
                    conn.execute(sql, [doc.num, articleDate, content]).catch(console.log);
                }).catch(error => {
                    console.error(error);
                })
            } catch (err) {
                //에러나면 터치하고 더이상 업데이트하지 않는다
                //대부분 게시물을 삭제한경우
                sql = `insert into list ( num ) values ( ? ) ON DUPLICATE KEY UPDATE touched = 1`;
                conn.execute(sql, [doc.num]).catch(console.log);
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

    //업데이트는 기다릴필요 없으니 병렬
    //await updateContent();
    await updateContent();
    console.log('[updateContent][end]', Date.now());
}

(async () => {//
    console.log(configs);
    conn = await mysql.createConnection({
        host: configs.DB_HOST,
        user: configs.DB_USER,
        password: configs.DB_PASS,
        database: 'dia2para'
    });
    const [rows, fields] = await conn.execute('select count(*) as cnt from list');
    totalCnt = rows[0].cnt;
    console.log("전체 저장된 갯수", totalCnt);

    //게시물 안에 들어가서 내용 추출
    await updateAll();
    cjob_updateContent.start();

})();
