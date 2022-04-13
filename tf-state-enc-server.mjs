/* global console */
/* eslint-disable no-console */
/* global Buffer */
/* global Promise */
/* global process */

import * as http from "http";
import * as path from "path";
import * as util from "util";
import { execFile as execFile_cb } from "child_process";
import { unlink, readFile, stat, open as fs_open, rename } from "fs/promises";
const execFile = util.promisify(execFile_cb);

let connid = 0;
let cmd_handler = null;
let terraform_dir = null;

function end_conn(connid, response, code, msg, log_msg, no_add_newline) {
  let msg_in_log = ` ${msg}`;
  if (!log_msg) {
    msg_in_log = "";
  }
  console.log(`[${connid}] END: code=${code}${msg_in_log}`);

  response.writeHead(code);
  if (!no_add_newline) {
    response.end(`${msg}\n`);
  } else {
    response.end(msg);
  }
}

async function safe_exec(cmd, args, request, response) {
  console.log(`[${connid}] ${request.method} exec(): ${cmd} ${args.join(" ")}`);

  try {
    const { stdout, stderr } = await execFile(cmd, args);
    if (stdout !== null && stdout != "") {
      console.log(`[${connid}] ${request.method} exec() STDOUT output: ${stdout}`);
    }
    if (stderr !== null && stderr != "") {
      const e = Error(`exec() produced STDERR output: ${stderr}`);
      e.code = 0;
      e.signal = 0;
      e.stderr = stderr;
      e.stdout = stdout;
      throw(e);
    }
    return true;
  } catch (e) {
    console.log(
      `[${connid}] ${request.method} exec() failed due to "${e}": exit_code=${e.code}, signal=${e.signal}, ` +
      `stderr="${e.stderr}", stdout="${e.stdout}"`
    );
    end_conn(connid, response, 500, `exec(${cmd}): failed`);
    return false;
  }
}

async function fs_create_exclusive(filename) {
  const fh = await fs_open(filename, "wx");
  await fh.close();
}

async function rename_verbose(from, to, request) {
  console.log(`[${connid}] ${request.method} rename(): "${from}" -> "${to}"`);
  await rename(from, to);
}

async function check_file_exists(filename) {
  try {
    await stat(filename);
    return true;
  } catch (e) {
    if (e.code == "ENOENT") {
      return false;
    } else {
      throw(e);
    }
  }
}

const requestListener = async function (request, response) {
  connid += 1;

  console.log(`[${connid}] ${request.method} ${request.url} [relative]`);

  const root_terraform_path = `${terraform_dir}/${request.url}`;
  const enc_filename = path.resolve(`${root_terraform_path}/terraform.encrypted-tfstate`);
  const dot_terraform_path = path.resolve(`${root_terraform_path}/.terraform`);
  const plain_bkp_filename = path.resolve(
    `${dot_terraform_path}/terraform.plain.tfstate.bkp.${Date.now()}`
  );
  const enc_tmp_filename = `${plain_bkp_filename}.encrypted`;
  const dec_tmp_filename = `${plain_bkp_filename}.decrypted`;

  for (const [_id, _path] of [["root", root_terraform_path], [".terraform", dot_terraform_path]]) {
    if (!await check_file_exists(_path)) {
      const errmsg = `"${_id}" path does not exist: ${dot_terraform_path}. Did you correctly set TERRAFORM_DIR?`;
      console.log(`[${connid}] ${request.method} ${errmsg}`);
      end_conn(connid, response, 500, `The ${errmsg}`);
      return;
    }
  }

  if (request.method == "GET") {
    console.log(`[${connid}] ${request.method} check if exists: ${enc_filename}`);
    if (!await check_file_exists(enc_filename)) {
      end_conn(connid, response, 404, "Not found");
      return;
    }

    await fs_create_exclusive(dec_tmp_filename);
    if (!await safe_exec(cmd_handler, ["decrypt", enc_filename, dec_tmp_filename], request, response)) {
      return;
    }

    const dec_data = await readFile(dec_tmp_filename);

    console.log(`[${connid}] ${request.method} remove(): ${dec_tmp_filename}`);
    await unlink(dec_tmp_filename);

    end_conn(connid, response, 200, dec_data, false, true);
  } else if (request.method == "POST") {
    // https://nodejs.org/en/docs/guides/anatomy-of-an-http-transaction/
    const request_body = await new Promise((resolve) => {
      let body = [];
      request.on("data", (chunk) => {
        body.push(chunk);
      });
      request.on("end", () => {
        body = Buffer.concat(body).toString();
        resolve(body);
      });
    });

    console.log(`[${connid}] ${request.method} backup unencrypted: ${plain_bkp_filename}`);
    const fh = await fs_open(plain_bkp_filename, "wx");
    await fh.writeFile(request_body);
    await fh.close();

    await fs_create_exclusive(enc_tmp_filename);
    if (!await safe_exec(cmd_handler, ["encrypt", plain_bkp_filename, enc_tmp_filename], request, response)) {
      return;
    }

    await rename_verbose(enc_tmp_filename, enc_filename, request);

    end_conn(connid, response, 200, "OK");
    return;
  } else {
    end_conn(connid, response, 400, `Bad request method: ${request.method}`);
    return;
  }
};

function main() {
  const argv = process.argv.slice(2);
  if (argv.length !== 2 || argv.includes("-h") || argv.includes("--help")) {
    const name = path.basename(process.argv[1]);
    process.stderr.write(`Usage: ${name} COMMAND_FOR_ENCRYPT_DECRYPT TERRAFORM_DIR\n`);
    process.stderr.write("\nERROR: Wrong command-line arguments.\n");
    process.exit(1);
  }
  cmd_handler = argv[0];
  terraform_dir = argv[1];

  const server = http.createServer(requestListener);
  const listenPort = 8181;
  const listenHost = "127.0.0.1";
  server.listen(listenPort, listenHost);

  console.log(`Server is listening on http://${listenHost}:${listenPort}`);
}

main();
