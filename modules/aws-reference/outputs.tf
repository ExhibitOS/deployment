# Copyright 2026 ExhibitOS contributors. SPDX-License-Identifier: Apache-2.0
output "instance_id" { value = aws_instance.exhibition.id }
output "private_ip" { value = aws_instance.exhibition.private_ip }
