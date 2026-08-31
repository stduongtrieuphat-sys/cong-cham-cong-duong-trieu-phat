const express = require("express");
const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const DB_FILE = path.join(__dirname, "data.json");

/* =====================================================
   CẤU HÌNH CÔNG TY
===================================================== */

const COMPANY_LAT = 10.912145556678649;
const COMPANY_LNG = 106.79440737355388;

/* Bán kính được phép chấm công */
const ALLOWED_RADIUS = 300;


/* =====================================================
   DATABASE
===================================================== */

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

const readDB = () =>
  JSON.parse(fs.readFileSync(DB_FILE, "utf8"));

const writeDB = (data) =>
  fs.writeFileSync(
    DB_FILE,
    JSON.stringify(data, null, 2)
  );


/* =====================================================
   SESSION
===================================================== */

const sessions = new Map();


/* =====================================================
   COOKIE
===================================================== */

function getCookie(req, name) {

  const cookieHeader = req.headers.cookie || "";

  const cookies = cookieHeader
    .split(";")
    .map(x => x.trim());

  const cookie = cookies.find(
    x => x.startsWith(name + "=")
  );

  if (!cookie) {
    return null;
  }

  return decodeURIComponent(
    cookie.substring(name.length + 1)
  );
}


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
    (lat2 - lat1) * Math.PI / 180;

  const dLon =
    (lon2 - lon1) * Math.PI / 180;

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
   KIỂM TRA ĐĂNG NHẬP
===================================================== */

function auth(req, res, next) {

  /* Ưu tiên Authorization */
  let token =
    req.headers.authorization || "";

  /* Nếu không có thì lấy cookie */
  if (!token) {
    token = getCookie(req, "dtp_session") || "";
  }

  const session = sessions.get(token);

  if (!session) {

    return res
      .status(401)
      .json({
        error: "Chưa đăng nhập."
      });
  }

  req.user = session;
  req.token = token;

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
        error: "Không có quyền quản trị."
      });
  }

  next();
}


/* =====================================================
   ĐĂNG NHẬP
===================================================== */

app.post("/api/login", (req, res) => {

  const db = readDB();

  const name =
    String(req.body.name || "").trim();

  const password =
    String(req.body.password || "");

  const user = db.users.find(
    x =>
      x.name === name &&
      x.password === password
  );

  if (!user) {

    return res
      .status(401)
      .json({
        error:
          "Sai tài khoản hoặc mật khẩu."
      });
  }

  const token =
    Math.random().toString(36).slice(2) +
    Date.now().toString(36);

  sessions.set(token, {
    name: user.name,
    role: user.role
  });

  /*
    Lưu phiên đăng nhập vào cookie.
    Nhờ vậy khi bấm /api/export trực tiếp
    trình duyệt vẫn nhận ra tài khoản.
  */

  res.setHeader(
    "Set-Cookie",
    `dtp_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`
  );

  res.json({
    ok: true,
    token,
    name: user.name,
    role: user.role
  });
});


/* =====================================================
   ĐĂNG XUẤT
===================================================== */

app.post("/api/logout", auth, (req, res) => {

  sessions.delete(req.token);

  res.setHeader(
    "Set-Cookie",
    "dtp_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
  );

  res.json({
    ok: true,
    message: "Đã đăng xuất."
  });
});


/* =====================================================
   THÔNG TIN NGƯỜI ĐANG ĐĂNG NHẬP
===================================================== */

app.get("/api/me", auth, (req, res) => {

  res.json({
    name: req.user.name,
    role: req.user.role
  });
});


/* =====================================================
   CHẤM CÔNG VÀO
===================================================== */

app.post("/api/checkin", auth, (req, res) => {

  if (req.user.role === "admin") {

    return res
      .status(403)
      .json({
        error:
          "Admin không chấm công bằng tài khoản quản trị."
      });
  }

  const {
    latitude,
    longitude
  } = req.body;

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

  const distance =
    distanceInMeters(
      latitude,
      longitude,
      COMPANY_LAT,
      COMPANY_LNG
    );

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

  const date =
    now.toLocaleDateString(
      "vi-VN",
      {
        timeZone: "Asia/Ho_Chi_Minh"
      }
    );

  const time =
    now.toLocaleTimeString(
      "vi-VN",
      {
        timeZone: "Asia/Ho_Chi_Minh",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      }
    );

  const todayRecords =
    db.records.filter(
      x =>
        x.user === req.user.name &&
        x.date === date
    );

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

  if (todayRecords.length >= 2) {

    return res
      .status(409)
      .json({
        error:
          "Bạn đã chấm đủ 2 ca trong ngày hôm nay."
      });
  }

  db.records.push({
    user: req.user.name,
    date,
    in: time,
    out: "",
    latitude,
    longitude,
    distance: Math.round(distance),
    session: todayRecords.length + 1
  });

  writeDB(db);

  res.json({
    ok: true,
    message:
      `Đã chấm công vào ca ${todayRecords.length + 1}.`,
    distance: Math.round(distance)
  });
});


/* =====================================================
   CHẤM CÔNG RA
===================================================== */

app.post("/api/checkout", auth, (req, res) => {

  if (req.user.role === "admin") {

    return res
      .status(403)
      .json({
        error: "Không hợp lệ."
      });
  }

  const db = readDB();

  const now = new Date();

  const date =
    now.toLocaleDateString(
      "vi-VN",
      {
        timeZone: "Asia/Ho_Chi_Minh"
      }
    );

  const time =
    now.toLocaleTimeString(
      "vi-VN",
      {
        timeZone: "Asia/Ho_Chi_Minh",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      }
    );

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

  record.out = time;

  writeDB(db);

  res.json({
    ok: true,
    message:
      "Đã chấm công ra."
  });
});


/* =====================================================
   NHÂN VIÊN XEM CÔNG
===================================================== */

app.get(
  "/api/my-records",
  auth,
  (req, res) => {

    const db = readDB();

    res.json(
      db.records
        .filter(
          x =>
            x.user === req.user.name
        )
        .reverse()
    );
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

    try {

      const db = readDB();

      const wb =
        new ExcelJS.Workbook();

      const ws =
        wb.addWorksheet("Cham cong");

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
          header: "Khoảng cách công ty (m)",
          key: "distance",
          width: 24
        }
      ];

      /* Tiêu đề đậm */

      ws.getRow(1).font = {
        bold: true
      };

      /* Dữ liệu */

      db.records.forEach(
        record => {

          ws.addRow({
            user: record.user,
            date: record.date,
            session: record.session,
            in: record.in,
            out:
              record.out ||
              "Chưa chấm ra",
            distance:
              record.distance ?? ""
          });

        }
      );

      /* Cố định dòng tiêu đề */

      ws.views = [
        {
          state: "frozen",
          ySplit: 1
        }
      ];

      /* Bộ lọc */

      ws.autoFilter = {
        from: "A1",
        to: "F1"
      };

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );

      res.setHeader(
        "Content-Disposition",
        'attachment; filename="Cham_cong_Duong_Trieu_Phat.xlsx"'
      );

      await wb.xlsx.write(res);

      res.end();

    } catch (error) {

      console.error(
        "EXPORT ERROR:",
        error
      );

      if (!res.headersSent) {

        res
          .status(500)
          .json({
            error:
              "Không thể xuất file Excel."
          });
      }
    }
  }
);


/* =====================================================
   TRANG CHỦ
===================================================== */

app.get("/", (req, res) => {

  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );
});


/* =====================================================
   CHẠY SERVER
===================================================== */

const PORT =
  process.env.PORT || 3000;

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `DTP attendance running on port ${PORT}`
    );

  }
);
