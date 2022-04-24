# Motivation

A [Terraform](https://www.terraform.io/) managed infrastructure strongly depends on both the [configuration files](https://www.terraform.io/language/files) and the real-life [state file](https://www.terraform.io/language/state/purpose).

Keeping those two components in sync is vital. There is no ideal solution but a popular one is to keep everything in GIT or another RCS. However, the Terraform state file contains sensitive data like passwords or other secrets. It's a good idea to encrypt the content of the state file, especially if you don't host your own RCS repository.

# Intro

The "terraform-state-encrypter" is a simple solution which lets you automatically keep your Terraform state file encrypted in your GIT/RCS repository. Emphasis is on "automatically". This is achieved in the following way:
* Terraform is configured to fetch and keep its state in a [remote HTTP backend](https://www.terraform.io/language/settings/backends/http).
* "terraform-state-encrypter" performs the role of this "remote HTTP backend" by running a server locally.
* Unencrypted copies are stored in the "[.terraform](https://www.terraform.io/cli/init)" subfolder which [traditionally](https://github.com/github/gitignore/blob/main/Terraform.gitignore) is ignored and not committed in GIT.
* The latest state is automatically kept encrypted in the GIT repository together with the Terraform configuration files.

Having the state file automatically kept encrypted in the GIT repository lets you manage it as any other file. You can seamslessly keep your Terraform configuration and state files in sync.

# Installation

1. Check out this repository locally.
2. Use one of the available encryption mechanisms in "[sample-crypto-handlers/](sample-crypto-handlers/)" or create your own. For this example, we will create a wrapper for "[tf-state-gpg-crypt](sample-crypto-handlers/tf-state-gpg-crypt)" in our "~/bin" directory named `tf-state-gpg-crypt`:
```bash
#!/bin/bash
set -u

export TF_STATE_GPG_CRYPT_PASSFILE=/%SOMEWHERE%/gpg-key-for-files-in-public-repos
exec /%PATH_WHERE_YOU_CHECKED_OUT_THIS_REPO%/sample-crypto-handlers/tf-state-gpg-crypt "$@"
```
3. Create another wrapper binary in "~/bin" named `tf-state-enc-server`, so that we can easily execute the server:
```bash
#!/bin/bash
set -u

cd /%PATH_WHERE_YOU_CHECKED_OUT_THIS_REPO% || exit 1
exec ./tf-state-enc-server "$@"
```
4. Replace "%PATH_WHERE_YOU_CHECKED_OUT_THIS_REPO%" with the directory path where you checked out this repository locally.
5. Make sure that you do a `chmod +x` for both newly created wrappers in "\~/bin". We assume that "\~/bin" is in your [$PATH](https://opensource.com/article/17/6/set-path-linux).

# Usage

Let's assume that we have the following Terraform directory structure which supports multiple deployment locations in both development or production environments:
```
terraform/
├── locations
│   ├── dev
│   │   └── germanywestcentral
│   │       ├── location.tf
│   │       └── main.tf
│   └── prod
│       └── germanywestcentral
│           ├── location.tf
│           └── main.tf
└── start-tf-state-enc-server
```

The file `main.tf` in "locations/dev/germanywestcentral" contains our usual Terraform definitions.

The file `location.tf` in "locations/dev/germanywestcentral" does the magic to connect Terraform with "terraform-state-encrypter". It contains the following code:
```
terraform {
  backend "http" {
    address = "http://localhost:8181/dev/germanywestcentral"
  }
}
```

Note that you must adapt the URL path for each location directory.

Finally, we have the file `start-tf-state-enc-server` in the very root directory. It starts the "terraform-state-encrypter" server which Terraform contacts as a "remote HTTP backend":
```bash
#!/bin/bash
set -u

# both files "tf-state-enc-server" and "tf-state-gpg-crypt" are in $PATH, because we created them in our "~/bin" directory
exec tf-state-enc-server tf-state-gpg-crypt "$(pwd)/locations"
```

The `"$(pwd)/locations"` variable automatically resolves to the root directory where we keep our Terraform configuration and state files. In this case this is "terraform/locations".

Once you have this set up, you can use Terraform as usual:
```bash
cd locations/dev/germanywestcentral
terraform init # do this only once

# any operations that you perform will automatically keep the state file encrypted in the GIT repository in "locations/dev/germanywestcentral"
terraform plan
terraform apply
```
