# Copyright 2026 ExhibitOS contributors. SPDX-License-Identifier: Apache-2.0
terraform {
  required_version = "= 1.12.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "= 6.42.0" }
  }
}
provider "aws" {
  region              = var.region
  allowed_account_ids = [var.account_id]
}
# Infrastructure only: approved OCI/compose runtime is installed through Generic SSH.
# No SSH key, password, artwork, user_data or latest AMI lookup is stored here.
resource "aws_instance" "exhibition" {
  ami                    = var.ami_id
  instance_type          = var.instance_type
  subnet_id              = var.subnet_id
  vpc_security_group_ids = var.security_group_ids
  key_name               = var.key_name
  associate_public_ip_address = false
  metadata_options {
    http_tokens = "required"
    http_endpoint = "enabled"
  }
  root_block_device {
    volume_type = "gp3"
    volume_size = var.root_gib
    encrypted   = true
    delete_on_termination = true
  }
  tags = { Name = var.project, ExhibitOSProject = var.project }
}
