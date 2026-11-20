"""Track new public Kilowallet releases for the publisher's protected release process."""
import json
import os
import re
import subprocess

UPSTREAM = 'Kilombino/kilowallet-ios'
PUBLISHER = 'romanmodin/RedWallet'
BASELINE = '2026-11-17T01:41:55Z'
TAG = re.compile(r'v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?')


def api(endpoint, *options):
    return json.loads(subprocess.check_output(['gh', 'api', endpoint, *options]))


def main():
    releases = api(f'repos/{UPSTREAM}/releases?per_page=100', '--paginate', '--slurp')
    for page in releases:
        for release in page:
            tag = release['tag_name']
            if release['draft'] or release['published_at'] <= BASELINE or not TAG.fullmatch(tag):
                continue
            sha = api(f'repos/{UPSTREAM}/commits/{tag}')['sha']
            status = api(f'repos/{UPSTREAM}/compare/{sha}...v1')['status']
            if status not in ('ahead', 'identical'):
                raise ValueError(f'{tag} is outside v1')
            title = f'Kilowallet TestFlight intake for {tag}'
            marker = f'<!-- kilowallet-release:{release["id"]}:{sha} -->'
            issues = api(f'repos/{PUBLISHER}/issues?state=all&per_page=100', '--paginate', '--slurp')
            prior = [i for batch in issues for i in batch if i['title'] == title and i['user']['login'] == 'github-actions[bot]']
            if prior:
                if any(marker not in (i['body'] or '') for i in prior):
                    raise ValueError(f'{tag} release identity changed')
                continue
            body = f'{marker}\nPublished {tag} at {sha}. Verify source, engine hashes, build number and qualification before protected signing.\n{release["html_url"]}'
            if os.environ.get('INTAKE_WRITE') == 'true':
                api(f'repos/{PUBLISHER}/issues', '-f', f'title={title}', '-f', f'body={body}')
            print(title, sha)
    print('Release scan complete')


if __name__ == '__main__':
    main()
