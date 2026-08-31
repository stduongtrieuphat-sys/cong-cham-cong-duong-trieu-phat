const express = require("express");
const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");

const app = express();

/* =====================================================
   CẤU HÌNH EXPRESS
===================================================== */

app.use(express.json());

const PUBLIC_DIR = path.join(__dirname, "public");

app.use(express.static(PUBLIC_DIR));

/* Trang chính */
app.get("/", (req, res) => {
  const indexFile = path.join(PUBLIC_DIR, "index.html");

  if (fs.existsSync(indexFile)) {
    res.sendFile(indexFile);
  } else {
    res.status(404).send(`
      <h2>Website chấm công chưa có giao diện</h2>
      <p>Hãy kiểm tra file <b>public/index.html</b>.</p>
    `);
  }
});


/* =====================================================
   DATABASE
===================================================== */

const DB_FILE = path.join(__dirname, "data.json");

if (!fs.existsSync(DB_FILE)) {

  fs.writeFileSync(
    DB_FILE,
    JSON.stringify(
      {
        users: [
          {
            name: "Lê Hiền",
            password: "1234",
            role: "employee"
          },
          {
            name: "Linh",
            password: "1234",
            role: "employee"
          },
          {
            name: "Admin",
            password: "admin123",
            role: "admin"
          }
        ],

        records: []
      },
      null,
      2
    )
  );
}


const readDB = () => {

  try {

    return JSON.parse(
      fs.readFileSync(DB_FILE, "utf8")
    );

  } catch (error) {

    return {
      users: [],
      records: []
    };
  }
};


const writeDB = (data) => {

  fs.writeFileSync(
    DB_FILE,
    JSON.stringify(data, null, 2)
  );
};


/* =====================================================
   CẤU HÌNH CÔNG TY
===================================================== */

/*
   Vị trí công ty lấy từ Google Maps bạn gửi
*/

const COMPANY_LAT = 10.912145556678649;
const COMPANY_LNG = 106.79440737355388;


/*
   Bán kính được phép chấm công
   300 mét
*/

const ALLOWED_RADIUS = 300;


/* =====================================================
   TÍNH KHOẢNG CÁCH GPS
===================================================== */

function distanceInMeters(
  lat1,
  lon1,
  lat2,
  lon2
) {

  const R = 6371000;

  const dLat =
    (lat2 - lat1) *
    Math.PI /
    180;

  const dLon =
    (lon2 - lon1) *
    Math.PI /
    180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;

  const c =
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    );

  return R * c;
}


/* =====================================================
   SESSION ĐĂNG NHẬP
===================================================== */

const sessions = new Map();


/* =====================================================
   KIỂM TRA ĐĂNG NHẬP
===================================================== */

function auth(req, res, next) {

  const token =
    req.headers.authorization || "";

  const session =
    sessions.get(token);

  if (!session) {

    return res
      .status(401)
      .json({
        error: "Chưa đăng nhập"
      });
  }

  req.user = session;

  next();
}


/* =====================================================
   KIỂM TRA ADMIN
===================================================== */

function admin(req, res, next) {

  if (req.user.role !== "admin") {

    return res
      .status(403)
      .json({
        error: "Không có quyền"
      });
  }

  next();
}


/* =====================================================
   ĐĂNG NHẬP
===================================================== */

app.post("/api/login", (req, res) => {

  const db = readDB();

  const user =
    db.users.find(
      x =>
        x.name === req.body.name &&
        x.password === req.body.password
    );

  if (!user) {

    return res
      .status(401)
      .json({
        error:
          "Sai tài khoản hoặc mật khẩu"
      });
  }


  const token =
    Math.random()
      .toString(36)
      .slice(2) +
    Date.now();


  sessions.set(
    token,
    {
      name: user.name,
      role: user.role
    }
  );


  res.json({
    token,
    name: user.name,
    role: user.role
  });
});


/* =====================================================
   THÔNG TIN NGƯỜI ĐANG ĐĂNG NHẬP
===================================================== */

app.get(
  "/api/me",
  auth,
  (req, res) => {

    res.json(req.user);

  }
);


/* =====================================================
   CHẤM CÔNG VÀO
=====================================================

   MỖI NGÀY ĐƯỢC 2 CA:

   CA 1:
   Vào buổi sáng
   Ra buổi sáng

   CA 2:
   Vào buổi chiều
   Ra buổi chiều

   Không được:
   - Vào lần 2 khi ca trước chưa ra
   - Quá 2 ca trong ngày
   - Chấm ngoài bán kính 300m
===================================================== */

app.post(
  "/api/checkin",
  auth,
  (req, res) => {

    /* Admin không chấm công */

    if (req.user.role === "admin") {

      return res
        .status(403)
        .json({
          error:
            "Admin không chấm công bằng tài khoản quản trị"
        });
    }


    const {
      latitude,
      longitude
    } = req.body;


    /* Kiểm tra GPS */

    if (
      typeof latitude !== "number" ||
      typeof longitude !== "number"
    ) {

      return res
        .status(400)
        .json({
          error:
            "Không lấy được vị trí. Hãy bật GPS/vị trí rồi thử lại."
        });
    }


    /* Tính khoảng cách */

    const distance =
      distanceInMeters(
        latitude,
        longitude,
        COMPANY_LAT,
        COMPANY_LNG
      );


    /* Kiểm tra bán kính */

    if (distance > ALLOWED_RADIUS) {

      return res
        .status(403)
        .json({
          error:
            `Bạn đang cách công ty khoảng ${Math.round(distance)} mét. Không thể chấm công ngoài phạm vi ${ALLOWED_RADIUS} mét.`
        });
    }


    const db = readDB();

    const now = new Date();


    /* Ngày Việt Nam */

    const date =
      now.toLocaleDateString(
        "vi-VN",
        {
          timeZone:
            "Asia/Ho_Chi_Minh"
        }
      );


    /* Giờ Việt Nam */

    const time =
      now.toLocaleTimeString(
        "vi-VN",
        {
          timeZone:
            "Asia/Ho_Chi_Minh",

          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit"
        }
      );


    /* =================================================
       LẤY CÁC CA TRONG NGÀY
    ================================================= */

    const todayRecords =
      db.records.filter(
        x =>
          x.user === req.user.name &&
          x.date === date
      );


    /* =================================================
       KIỂM TRA CA ĐANG MỞ
    ================================================= */

    const openRecord =
      todayRecords.find(
        x => !x.out
      );


    if (openRecord) {

      return res
        .status(409)
        .json({
          error:
            "Bạn đang có một ca chưa chấm công ra."
        });
    }


    /* =================================================
       TỐI ĐA 2 CA / NGÀY
    ================================================= */

    if (todayRecords.length >= 2) {

      return res
        .status(409)
        .json({
          error:
            "Bạn đã chấm đủ 2 ca trong ngày hôm nay."
        });
    }


    /* =================================================
       TẠO CA MỚI
    ================================================= */

    const sessionNumber =
      todayRecords.length + 1;


    db.records.push({

      user: req.user.name,

      date: date,

      in: time,

      out: "",

      latitude: latitude,

      longitude: longitude,

      distance:
        Math.round(distance),

      session:
        sessionNumber

    });


    writeDB(db);


    res.json({

      ok: true,

      message:
        `Đã chấm công vào ca ${sessionNumber}.`,

      session:
        sessionNumber,

      distance:
        Math.round(distance)

    });
  }
);


/* =====================================================
   CHẤM CÔNG RA
===================================================== */

app.post(
  "/api/checkout",
  auth,
  (req, res) => {

    /* Admin không chấm công */

    if (req.user.role === "admin") {

      return res
        .status(403)
        .json({
          error: "Không hợp lệ"
        });
    }


    const db = readDB();

    const now = new Date();


    /* Ngày Việt Nam */

    const date =
      now.toLocaleDateString(
        "vi-VN",
        {
          timeZone:
            "Asia/Ho_Chi_Minh"
        }
      );


    /* Giờ Việt Nam */

    const time =
      now.toLocaleTimeString(
        "vi-VN",
        {
          timeZone:
            "Asia/Ho_Chi_Minh",

          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit"
        }
      );


    /* =================================================
       TÌM CA CHƯA RA
    ================================================= */

    const record =
      db.records
        .slice()
        .reverse()
        .find(
          x =>
            x.user === req.user.name &&
            x.date === date &&
            !x.out
        );


    if (!record) {

      return res
        .status(409)
        .json({
          error:
            "Không tìm thấy ca đang mở."
        });
    }


    /* Ghi giờ ra */

    record.out = time;


    writeDB(db);


    res.json({

      ok: true,

      message:
        `Đã chấm công ra ca ${record.session}.`,

      session:
        record.session,

      in:
        record.in,

      out:
        record.out

    });
  }
);


/* =====================================================
   NHÂN VIÊN XEM CÔNG CỦA MÌNH
===================================================== */

app.get(
  "/api/my-records",
  auth,
  (req, res) => {

    const db = readDB();

    const records =
      db.records
        .filter(
          x =>
            x.user === req.user.name
        )
        .reverse();


    res.json(records);
  }
);


/* =====================================================
   ADMIN XEM TẤT CẢ
===================================================== */

app.get(
  "/api/records",
  auth,
  admin,
  (req, res) => {

    const db = readDB();

    res.json(
      db.records
        .slice()
        .reverse()
    );
  }
);


/* =====================================================
   XUẤT EXCEL
===================================================== */

app.get(
  "/api/export",
  auth,
  admin,
  async (req, res) => {

    const db = readDB();

    const wb =
      new ExcelJS.Workbook();


    const ws =
      wb.addWorksheet(
        "Cham cong"
      );


    ws.columns = [

      {
        header: "Nhân viên",
        key: "user",
        width: 22
      },

      {
        header: "Ngày",
        key: "date",
        width: 14
      },

      {
        header: "Ca",
        key: "session",
        width: 8
      },

      {
        header: "Giờ vào",
        key: "in",
        width: 14
      },

      {
        header: "Giờ ra",
        key: "out",
        width: 14
      },

      {
        header:
          "Khoảng cách công ty (m)",
        key: "distance",
        width: 24
      }

    ];


    db.records.forEach(
      record => {

        ws.addRow({

          user:
            record.user,

          date:
            record.date,

          session:
            record.session,

          in:
            record.in,

          out:
            record.out ||
            "Chưa chấm ra",

          distance:
            record.distance ?? ""

        });

      }
    );


    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );


    res.setHeader(
      "Content-Disposition",
      "attachment; filename=Cham_cong_Duong_Trieu_Phat.xlsx"
    );


    await wb.xlsx.write(res);

    res.end();
  }
);


/* =====================================================
   CHẠY SERVER
===================================================== */

/*
   Render yêu cầu dùng PORT mà hệ thống cấp.
   Nếu chạy máy tính thì mặc định dùng 3000.
*/

const PORT =
  process.env.PORT || 3000;


app.listen(
  PORT,
  () => {

    console.log(
      `DTP attendance running on port ${PORT}`
    );

  }
);
