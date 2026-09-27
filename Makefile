# storage — developer entry points (OSS_SPEC §9). CI calls these exact targets.
# The e2e suite and the reference app run the oss-framework client from source:
# set OSS_FRAMEWORK_DIR (default ../oss-framework; `make framework` clones it).

SHELL := /bin/bash
FRAMEWORK_REF := $(shell cat e2e/framework-ref)
OSS_FRAMEWORK_DIR ?= $(abspath ../oss-framework)
export OSS_FRAMEWORK_DIR

.PHONY: build test test-app test-unit test-e2e lint fmt fmt-check release clean framework docker website website-dev man shellcheck actionlint validate

build:
	npm run build --workspace packages/server
	npm run build --workspace packages/testkit

test: build test-unit test-e2e

# Browser tests of the reference app (needs Chromium; CI installs it).
test-app: build
	npm run test:e2e --workspace apps/reference

test-unit:
	npm run test --workspace packages/server
	npm run test --workspace packages/testkit

test-e2e:
	npm run test --workspace e2e

lint:
	npx eslint .
	npx tsc --noEmit -p packages/server
	npx tsc --noEmit -p packages/testkit
	npx tsc --noEmit -p e2e
	npx tsc --noEmit -p apps/reference

fmt:
	npx prettier --write .

fmt-check:
	npx prettier --check .

release: clean
	NODE_ENV=production npm run build --workspace packages/server
	NODE_ENV=production npm run build --workspace packages/testkit

clean:
	rm -rf packages/*/dist apps/*/dist website/dist coverage

# Clone the framework at the ref the e2e suite is pinned to.
framework:
	@if [ ! -d "$(OSS_FRAMEWORK_DIR)/.git" ]; then \
	  git clone --depth 1 --branch "$(FRAMEWORK_REF)" https://github.com/niclaslindstedt/oss-framework "$(OSS_FRAMEWORK_DIR)"; \
	fi
	cd "$(OSS_FRAMEWORK_DIR)" && npm ci --no-audit --no-fund

docker:
	docker build -t storage-server:dev .

man:
	npm run gen:man --workspace packages/server

shellcheck:
	shellcheck scripts/*.sh

actionlint:
	actionlint

validate:
	bash scripts/validate.sh .
