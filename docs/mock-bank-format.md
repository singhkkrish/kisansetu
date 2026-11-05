# Mock bank payment file

**This format is a mock. It is KisanSetu's own simple layout. It has not been
checked against any real bank's specification, and the file must not be uploaded
to a bank.** Every bank publishes its own bulk-payment format (column order,
field lengths, allowed characters, file naming, header and trailer rows, and
sometimes a signed or encrypted wrapper). Before real payments, get the format
in writing from the Producer Company's bank and replace the builder in
`src/lib/payments/bank-file.ts` accordingly.

## Default layout

A UTF-8 CSV, one line per farmer, lines ending in CRLF, with a header row.

| Column             | Content                                                        | Example                |
| ------------------ | -------------------------------------------------------------- | ---------------------- |
| `beneficiary_name` | Account holder's name, as in the farmer registry               | `Sunil Jadhav`         |
| `account_number`   | 9 to 18 digits, no spaces                                      | `504618608387888`      |
| `ifsc`             | Bank branch code: 4 letters, `0`, then 6 letters or digits     | `SBIN0012874`          |
| `amount`           | Rupees with a dot and exactly two decimals, no thousands comma | `59752.00`             |
| `payment_ref`      | Unique per payment: `<run number>-<three digits>`              | `PR-20261105-001-001`  |
| `payment_run_id`   | The payment run's number                                       | `PR-20261105-001`      |

One more column can be switched on: `farmer_id` (the member code, e.g. `FM00101`).

Rows are ordered by `payment_ref`, so downloading the same run twice gives the
same file. The file name is `KISANSETU-MOCK-<run number>.csv`, and the download
carries the response header `X-Mock-Bank-File: true`.

Fields containing a comma, a double quote or a line break are quoted (RFC 4180).
Any value starting with `=`, `+`, `-` or `@` is prefixed with an apostrophe so a
spreadsheet cannot run it as a formula.

Open the file in a spreadsheet by importing it with the account number column
set to **text**, otherwise leading zeros and long numbers may be altered.

## Configuring the layout

Set these in `.env.local` (all optional):

| Variable              | Values                                 | Default                                                          |
| --------------------- | -------------------------------------- | ---------------------------------------------------------------- |
| `BANK_FILE_COLUMNS`   | comma separated column names, in order | `beneficiary_name,account_number,ifsc,amount,payment_ref,payment_run_id` |
| `BANK_FILE_DELIMITER` | `comma`, `semicolon`, `pipe`, `tab`    | `comma`                                                          |
| `BANK_FILE_HEADER`    | `true`, `false`                        | `true`                                                           |

An unknown column name, a repeated column or an unknown delimiter is ignored and
the default is used, so a typo cannot produce a file nobody expects.

## What the file contains and who can get it

* Only office managers can download it, and only after the payment run has been approved.
* The first download marks the run as sent to the bank (its payments become
  *Processing*). Later downloads are logged as re-downloads and change nothing.
* The bank details come from the copy taken when the run was generated, so editing
  a farmer's bank account afterwards cannot redirect an approved run.
* The full account numbers are in the file only. Screens show the last four digits.

## Simulated bank response

There is no bank behind the app. On a run whose file has been downloaded, the
manager can mark payments **Paid** (a mock bank reference such as `MOCKUTR26110512AB34CD` is
recorded) or **Failed** (with a reason). A settled payment can never be flipped.
A failed payment stays on the run, in red, until the manager returns its purchases
to unpaid so they can go into a new run.
