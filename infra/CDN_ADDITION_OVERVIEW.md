# CDN Addition to DTP Infrastructure Overview

## Background

This document outlines the plan to integrate AWS CloudFront as a CDN layer in front of
the existing DTP Africa EC2 deployment. No changes have been made to the infrastructure
yet — this is a reference document for when the go-ahead is given.

---

## What a CDN Does for the App

Right now every request — whether it's a Nigerian user loading the React app or a South
African user hitting the API — hits the single EC2 instance in `us-east-1`. CloudFront
fixes this by:

- Serving static assets (JS, CSS, images, fonts) from edge locations closest to the user
- Absorbing traffic spikes so the `t3.small` isn't overwhelmed
- Adding HTTPS termination and a free SSL certificate (no Certbot needed)
- Providing DDoS protection at the edge

---

## What Goes on the CDN vs What Stays on EC2

| Traffic type | Where it goes | Why |
|---|---|---|
| Static assets (`/assets/*`, images, fonts) | CloudFront edge cache | Never changes between deploys |
| React app HTML (`/`, `/players/*`, etc.) | CloudFront → EC2 nginx | Short TTL, SPA routing needs fallback |
| API calls (`/api/*`) | CloudFront pass-through to EC2 | Dynamic, must not be cached |

---

## Architecture Change

**Before:**
```
Internet → Elastic IP → EC2 (nginx → api container)
```

**After:**
```
Internet → CloudFront distribution
              ├── /assets/*   → cached at edge (TTL: 1 year)
              ├── /api/*      → forwarded to EC2, no cache
              └── /*          → forwarded to EC2, short TTL (HTML)
                                      │
                                EC2 (nginx → api container)
```

CloudFront sits in front of the Elastic IP. The domain's A record points to CloudFront,
not the EC2 directly.

---

## Terraform Changes Required

Add the following to `infra/terraform/main.tf` when ready to implement:

```hcl
resource "aws_cloudfront_distribution" "app" {
  enabled             = true
  default_root_object = "index.html"
  aliases             = ["yourdomain.com"]  # replace with real domain

  origin {
    domain_name = aws_eip.server.public_ip
    origin_id   = "ec2-origin"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"  # EC2 speaks HTTP, CloudFront handles HTTPS
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # Static assets — cache aggressively
  ordered_cache_behavior {
    path_pattern     = "/assets/*"
    allowed_methods  = ["GET", "HEAD"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "ec2-origin"
    compress         = true

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 31536000  # 1 year
    max_ttl                = 31536000
  }

  # API — never cache
  ordered_cache_behavior {
    path_pattern     = "/api/*"
    allowed_methods  = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "ec2-origin"
    compress         = false

    forwarded_values {
      query_string = true
      headers      = ["Authorization", "Content-Type", "X-Admin-Api-Key"]
      cookies { forward = "all" }
    }

    viewer_protocol_policy = "https-only"
    min_ttl                = 0
    default_ttl            = 0
    max_ttl                = 0
  }

  # Default — HTML pages, short cache
  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "ec2-origin"
    compress         = true

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 3600   # 1 hour for HTML
    max_ttl                = 86400
  }

  # SPA fallback — 404s return index.html for React Router
  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    cloudfront_default_certificate = true  # free *.cloudfront.net cert
    # For a custom domain, replace the above with:
    # acm_certificate_arn      = aws_acm_certificate.app.arn
    # ssl_support_method       = "sni-only"
    # minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = { Name = "${var.project}-${var.environment}-cdn" }
}

output "cloudfront_domain" {
  description = "CloudFront distribution domain — point your DNS CNAME here"
  value       = aws_cloudfront_distribution.app.domain_name
}
```

---

## Nginx Change Required

Update `infra/nginx.staging.conf` to pass the real visitor IP through CloudFront
(otherwise all traffic appears to come from CloudFront's IP):

```nginx
set_real_ip_from 0.0.0.0/0;
real_ip_header X-Forwarded-For;
```

---

## Cost

CloudFront has a generous free tier: **1 TB data transfer + 10 million requests/month**
free for the first 12 months. After that it's roughly **$0.085/GB** for data transfer —
at typical traffic levels for this platform that's under **$5/month**.

---

## When to Add This

The current EC2-only setup works well for the staging phase. Add CloudFront when:

- A custom domain is ready to point at it
- Users outside the US report slow load times
- HTTPS is needed without managing Certbot manually
- Traffic volume justifies the additional edge caching layer

---

## Implementation Steps (when approved)

1. Add the Terraform block above to `infra/terraform/main.tf`
2. Update `infra/nginx.staging.conf` with the `real_ip` directives
3. Add `cloudfront_domain` to Terraform outputs
4. Run `terraform apply` — CloudFront provisioning takes 10–15 minutes
5. Update DNS: point domain CNAME to the CloudFront domain name from outputs
6. Test: verify `/api/v1/health` returns 200 and static assets load from edge
