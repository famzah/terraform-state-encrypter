#!/bin/bash
set -u

function die() {
	echo ERROR: "$@" >&2
	exit 1
}

function post_then_check() {
	local datafile="$1"

	diff -u <(echo "OK") <(curl -sS --data-binary "@$datafile" http://127.0.0.1:8181/) \
		|| die "Expected OK for the POST command"

	diff -q "$datafile" "$dir/terraform.encrypted-tfstate" >/dev/null && die "not encrypted"

	diff -u "$datafile" <(curl -sS http://127.0.0.1:8181/) || die "decrypted diff"
}

dir="$(mktemp -d)" || exit 1

cat <<EOF
Please open a new shell and start the server using the following command:

./tf-state-enc-server sample-crypto-handlers/tf-state-no-crypt $dir

Then press Enter to execute the tests.
EOF
read

mkdir "$dir/.terraform" || exit 1 # Terraform does this on "terraform init"

diff -u <(echo "Not found") <(curl -sS http://127.0.0.1:8181/) || die "Expected an empty file"

post_then_check dummy-tf.state.1
post_then_check dummy-tf.state.2

# sort by modification time, newest first
cnt=0
for bkpfile in $(ls -1 "$dir/.terraform"); do
	cnt=$(( $cnt + 1 ))
	diff -u "$dir/.terraform/$bkpfile" "dummy-tf.state.$cnt" || die "Backup $cnt diff"
done

rm -r "$dir"

echo "Tests are OK."
