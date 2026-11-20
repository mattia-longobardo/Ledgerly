.PHONY: help install lint test ci deploy

help: ## List the targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | sed 's/:.*## /\t/'

install: ## Install the dependencies
	npm ci

lint: ## Format check, ESLint, cleanliness and type check
	npm run format:check
	npm run lint
	npm run typecheck

test: ## Unit tests (the other suites: docs/testing.md)
	npm test

ci: install lint test ## CI entry point

deploy: ## Release from this checkout: make deploy ID=<release id> (AGENTS.md, Deploy)
	@test -n "$(ID)" || { echo "usage: make deploy ID=<release id>"; exit 2; }
	sh scripts/release.sh $(ID)
