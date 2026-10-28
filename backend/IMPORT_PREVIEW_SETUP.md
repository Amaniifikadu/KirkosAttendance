# Administrator workbook preview and import

The administrator preview validates the twelve configured class worksheets
without writing to MongoDB. The separate confirmation endpoint imports only
valid rows after a signed-in administrator checks the warnings and explicitly
confirms. Invalid rows are skipped. The import uses a MongoDB transaction,
creates missing class records only during the confirmed transaction, and never
overwrites existing students.

## Configure administrator access

Use the existing ignored `backend/.env` file and set:

- `JWT_SECRET`: a randomly generated secret of at least 32 characters.
- Keep the existing `MONGODB_URI` unchanged unless you intentionally choose a
  different database.
- `PORT`: optional; defaults to `5000`.

The administrator account is stored in MongoDB. Set up the first account with
the local, one-time bootstrap command below. There is no public registration
route. Generate a JWT secret locally with PowerShell:

```powershell
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$bytes = New-Object byte[] 48
$rng.GetBytes($bytes)
[Convert]::ToBase64String($bytes)
$rng.Dispose()
```

Keep the generated secret private and do not commit `.env`. The bootstrap
command hashes the administrator password itself; do not put the password or
its hash in `.env`.

## Create the first administrator once

Start PowerShell in `backend`. The command connects to the database selected by
the existing `MONGODB_URI`, prompts for the administrator email, and accepts the
password without displaying it. The password is bcrypt-hashed before it is
stored. It refuses to run if any admin already exists.

```powershell
npm run admin:bootstrap
```

The initial administrator is one-time only, enforced by a unique database
index as well as a pre-check. Do not run the command with a database URI you
have not verified. The script prints the connected database name but never the
connection URI, password, password hash, or JWT secret.

## Start the API and request a preview

Start MongoDB and the backend:

```powershell
cd backend
npm run dev
```

Sign in to get a short-lived administrator token. Enter the password at the
hidden prompt:

```powershell
$adminEmail = Read-Host 'Administrator email'
$securePassword = Read-Host 'Administrator password' -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
  $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  $login = Invoke-RestMethod -Method Post `
  -Uri http://localhost:5000/api/auth/admin/login `
  -ContentType 'application/json' `
  -Body (@{ email = $adminEmail; password = $password } | ConvertTo-Json)
  $token = $login.token
} finally {
  Remove-Variable password -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
}
```

Request a preview. The response contains student names and row metadata for the
authorized administrator, but omits parent, student, and Telegram phone fields:

```powershell
curl.exe -X POST `
  -H "Authorization: Bearer $token" `
  -F "workbook=@C:\path\to\your-workbook.xlsx" `
  http://localhost:5000/api/students/import/preview
```

The upload must be a valid `.xlsx` file no larger than 10 MB, with exactly the
twelve expected Amharic class-sheet names. Header rows are detected within the
first 25 rows. The workbook's `ተ.ቁ` value is preserved as a string and combined
with the configured worksheet number (1-12) for the unique student key.
Preview reports missing names, invalid ages, duplicate class-local serials, and
serials already present in the database. Phone/contact fields are never
included in the preview response.

## Explicitly confirm an import

The preview ID is held in server memory for up to 30 minutes and must be
confirmed against the same running backend process. Review the response and
class totals in the UI first. The web UI enables its confirmation button only
after its checkbox is selected and `IMPORT` is typed.

The API endpoint is `POST /api/students/import/confirm`; it requires the
administrator bearer token and JSON body:

```json
{
  "previewId": "the-previewId-returned-by-preview",
  "confirmation": "IMPORT"
}
```

The backend will not import a workbook twice (byte-identical workbook hash),
will not overwrite an existing class-local serial, and aborts the transaction
if a duplicate key is detected. Existing class documents are preserved; the
twelve configured classes are inserted only when missing during the confirmed
transaction. A MongoDB deployment that supports transactions (such as an Atlas
replica-set cluster) is required.

## Frontend

From the frontend directory:

```powershell
cd frontend
npm install
npm run dev
```

Vite proxies `/api` calls to `http://localhost:5000` during development. Start
the backend separately first. To make a production build, run `npm run build`.
