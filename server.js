const express = require("express");
const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const DB_FILE = path.join(__dirname, "data.json");

// =====================================================
// CẤU HÌNH CÔNG TY DƯƠNG TRIỆU PHÁT
// =====================================================

const COMPANY_LAT = 10.912145556678649;
const COMPANY_LON = 106.79440737355388;

// Nhân viên phải ở trong bán kính 200m
const MAX_DISTANCE = 200;

// =====================================================
// DATABASE
// =====================================================

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

function readDB() {
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// =====================================================
// SESSION
// =====================================================

const sessions = new Map();

// =====================================================
// TÍNH KHOẢNG CÁCH GPS
// =====================================================

function distanceMeter(lat1, lon1, lat2, lon2) {
  const R = 6371000;

  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;

  const c =
    2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// =====================================================
// LẤY NGÀY / GIỜ VIỆT NAM
// =====================================================

function getVietnamDate() {
  return new Date().toLocaleDateString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh"
  });
}

function getVietnamTime() {
  return new Date().toLocaleTimeString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

// =====================================================
// AUTH
// =====================================================

function auth(req, res, next) {
  const token = req.headers.authorization || "";

  const session = sessions.get(token);

  if (!session) {
    return res.status(401).json({
      error: "Bạn chưa đăng nhập."
    });
  }

  req.user = session;
  next();
}

function adminOnly(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({
      error: "Bạn không có quyền thực hiện thao tác này."
    });
  }

  next();
}

// =====================================================
// KIỂM TRA GPS
// =====================================================

function checkLocation(req, res) {
  const lat = Number(req.body.lat);
  const lon = Number(req.body.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    res.status(400).json({
      error:
        "Không lấy được vị trí của thiết bị. Vui lòng bật GPS và cho phép website truy cập vị trí."
    });

    return false;
  }

  const distance = distanceMeter(
    COMPANY_LAT,
    COMPANY_LON,
    lat,
    lon
  );

  if (distance > MAX_DISTANCE) {
    res.status(403).json({
      error:
        `Bạn đang cách công ty khoảng ${Math.round(
          distance
        )}m. Chỉ được chấm công trong phạm vi ${MAX_DISTANCE}m quanh công ty.`,
      distance: Math.round(distance)
    });

    return false;
  }

  req.location = {
    lat,
    lon,
    distance: Math.round(distance)
  };

  return true;
}

// =====================================================
// ĐĂNG NHẬP
// =====================================================

app.post("/api/login", (req, res) => {
  const db = readDB();

  const name = String(req.body.name || "").trim();
  const password = String(req.body.password || "");

  const user = db.users.find(
    (u) =>
      u.name === name &&
      u.password === password
  );

  if (!user) {
    return res.status(401).json({
      error: "Sai tên đăng nhập hoặc mật khẩu."
    });
  }

  const token =
    Math.random().toString(36).substring(2) +
    Date.now().toString(36);

  sessions.set(token, {
    name: user.name,
    role: user.role
  });

  res.json({
    ok: true,
    token,
    name: user.name,
    role: user.role
  });
});

// =====================================================
// THÔNG TIN TÀI KHOẢN
// =====================================================

app.get("/api/me", auth, (req, res) => {
  res.json({
    name: req.user.name,
    role: req.user.role
  });
});

// =====================================================
// XÁC ĐỊNH CA
// =====================================================

function getShift() {
  const hour = Number(
    new Date().toLocaleString("en-US", {
      timeZone: "Asia/Ho_Chi_Minh",
      hour: "2-digit",
      hour12: false
    })
  );

  if (hour < 12) {
    return "Sáng";
  }

  return "Chiều";
}

// =====================================================
// CHẤM VÀO
// =====================================================

app.post("/api/checkin", auth, (req, res) => {
  if (req.user.role === "admin") {
    return res.status(403).json({
      error: "Tài khoản Admin không dùng để chấm công."
    });
  }

  if (!checkLocation(req, res)) {
    return;
  }

  const db = readDB();

  const date = getVietnamDate();
  const time = getVietnamTime();
  const shift = getShift();

  const today = db.records.filter(
    (r) =>
      r.user === req.user.name &&
      r.date === date
  );

  const sameShift = today.find(
    (r) => r.shift === shift
  );

  if (sameShift && sameShift.in && !sameShift.out) {
    return res.status(409).json({
      error: `Bạn đã chấm VÀO ca ${shift}. Vui lòng chấm RA trước.`
    });
  }

  if (sameShift && sameShift.in && sameShift.out) {
    return res.status(409).json({
      error: `Ca ${shift} hôm nay đã chấm đủ VÀO và RA.`
    });
  }

  if (today.length >= 2) {
    return res.status(409).json({
      error: "Bạn đã chấm đủ 2 ca trong ngày."
    });
  }

  db.records.push({
    user: req.user.name,
    date,
    shift,
    in: time,
    out: "",
    latIn: req.location.lat,
    lonIn: req.location.lon,
    distanceIn: req.location.distance,
    latOut: "",
    lonOut: "",
    distanceOut: "",
    status: "Đang làm"
  });

  writeDB(db);

  res.json({
    ok: true,
    message: `Chấm VÀO ca ${shift} thành công.`,
    shift,
    time
  });
});

// =====================================================
// CHẤM RA
// =====================================================

app.post("/api/checkout", auth, (req, res) => {
  if (req.user.role === "admin") {
    return res.status(403).json({
      error: "Tài khoản Admin không dùng để chấm công."
    });
  }

  if (!checkLocation(req, res)) {
    return;
  }

  const db = readDB();

  const date = getVietnamDate();
  const time = getVietnamTime();
  const shift = getShift();

  const record = db.records
    .slice()
    .reverse()
    .find(
      (r) =>
        r.user === req.user.name &&
        r.date === date &&
        r.shift === shift &&
        r.in &&
        !r.out
    );

  if (!record) {
    return res.status(409).json({
      error:
        `Không tìm thấy ca ${shift} đang mở. Bạn phải chấm VÀO trước.`
    });
  }

  record.out = time;
  record.latOut = req.location.lat;
  record.lonOut = req.location.lon;
  record.distanceOut = req.location.distance;
  record.status = "Hoàn tất";

  writeDB(db);

  res.json({
    ok: true,
    message: `Chấm RA ca ${shift} thành công.`,
    shift,
    time
  });
});

// =====================================================
// NHÂN VIÊN XEM LỊCH SỬ CỦA MÌNH
// =====================================================

app.get("/api/my-records", auth, (req, res) => {
  const db = readDB();

  const records = db.records
    .filter((r) => r.user === req.user.name)
    .slice()
    .reverse();

  res.json(records);
});

// =====================================================
// ADMIN XEM TẤT CẢ
// =====================================================

app.get(
  "/api/records",
  auth,
  adminOnly,
  (req, res) => {
    const db = readDB();

    res.json(
      db.records
        .slice()
        .reverse()
    );
  }
);

// =====================================================
// XUẤT EXCEL
// =====================================================

app.get(
  "/api/export",
  auth,
  adminOnly,
  async (req, res) => {
    const db = readDB();

    const workbook = new ExcelJS.Workbook();

    const sheet =
      workbook.addWorksheet("Chấm công");

    sheet.columns = [
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
        key: "shift",
        width: 12
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
        header: "Khoảng cách vào (m)",
        key: "distanceIn",
        width: 22
      },
      {
        header: "Khoảng cách ra (m)",
        key: "distanceOut",
        width: 22
      },
      {
        header: "Trạng thái",
        key: "status",
        width: 18
      }
    ];

    db.records.forEach((r) => {
      sheet.addRow({
        user: r.user,
        date: r.date,
        shift: r.shift,
        in: r.in,
        out: r.out,
        distanceIn: r.distanceIn,
        distanceOut: r.distanceOut,
        status: r.status
      });
    });

    sheet.getRow(1).font = {
      bold: true
    };

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.setHeader(
      "Content-Disposition",
      'attachment; filename="Cham_cong_Duong_Trieu_Phat.xlsx"'
    );

    await workbook.xlsx.write(res);

    res.end();
  }
);

// =====================================================
// SERVER
// =====================================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(
    `Cổng chấm công Dương Triệu Phát đang chạy tại cổng ${PORT}`
  );
});
