import { Dump, Wiki, Version, DumpOptions, WikiOptions, VersionOptions } from './types';
import { scrape, scrapeMultiple, WIKI_URL } from './utils';

export * from './types';
export { WIKI_URL };

/**
 *  Returns the last day of a month
 *  @param year The year of which you want to compute the last month day
 *  @param month The month of which you want to compute the last day
 *  @retrurns The last day of the month
 */
function lastMonthDay(year: number, month: number): number {
    return new Date(year, month + 1).getMonth();
}

/**
 * Parses the time extracted by the scraper and returns the analogue details object
 * @param time The time extracted by the scraper
 * @returns The parsed time as an object
 */
function parseTime(time: string): { from: Date | null; to: Date | null } {
    if (time === 'all-time') {
        return { from: null, to: null };
    }

    const monthAndYear = time.split('-').map(el => +el);
    const [year, month] = monthAndYear;

    return month
        ? {
              from: new Date(year, month - 1, 1),
              to: new Date(year, month - 1, lastMonthDay(year, month - 1))
          }
        : { from: new Date(year, 0, 1), to: new Date(year, 11, 31) };
}

/**
 * Fetches the dumps of a wiki of the mediawiki history dumps
 * @param version The version of the wiki (yyyy-mm or 'latest')
 * @param wiki The wiki whose dumps will be returned (e.g. 'itwiki')
 * @param options The options of the function
 * @returns The fetched dumps
 */
export async function fetchDumps(version: string, wiki: string, options: DumpOptions = {}): Promise<Dump[]> {
    if (version === 'latest') {
        const latestVersion = (await fetchLatestVersion())?.version;
        if (!latestVersion) {
            throw new Error('Latest version not found');
        }
        version = latestVersion;
    }

    const url = `${WIKI_URL}/${version}/${wiki}`;
    const regex = new RegExp(
        `<a href="(?<filename>${version}\\.${wiki}\\.(?<time>[\\d\\w-]+)\\.tsv\\.bz2)">.+<\\/a>\\s+(?<lastUpdate>\\d{2}-\\w{3}-\\d{4} \\d{2}:\\d{2})\\s+(?<bytes>\\d+)`,
        'gm'
    );
    const groups = ['filename', 'time', 'lastUpdate', 'bytes'];
    const dumps = await scrapeMultiple(url, regex, groups);
    return dumps
        .map(dump => ({
            ...dump,
            ...parseTime(dump.time),
            lastUpdate: new Date(Date.parse(dump.lastUpdate)),
            url: `${url}/${wiki}`
        }))
        .filter(
            dump =>
                dump.time === 'all-time' ||
                ((!options.start || options.start <= dump.from) && (!options.end || options.end >= dump.to))
        );
}

/**
 * Fetches the wikies of a version of the mediawiki history dumps
 * @param version The version of the wiki (yyyy-mm or 'latest')
 * @param options The options of the function
 * @returns The fetched wikies
 */
export async function fetchWikies(version: string, options: WikiOptions = {}): Promise<Wiki[]> {
    if (version === 'latest') {
        const latestVersion = (await fetchLatestVersion())?.version;
        if (!latestVersion) {
            throw new Error('Latest version not found');
        }
        version = latestVersion;
    }

    const url = `${WIKI_URL}/${version}`;
    const regex = /<a href="(?<wiki>\w+)\/">/g;
    const wikies = await scrape(url, regex);
    const parsedWikies = wikies
        .map(wiki => ({
            wiki,
            url: `${url}/${wiki}`
        }))
        .filter(
            wiki =>
                (!options.lang || wiki.wiki.startsWith(options.lang)) &&
                (!options.wikitype || wiki.wiki.endsWith(options.wikitype))
        );
    return await Promise.all(
        parsedWikies.map(async wiki =>
            options.dumps
                ? {
                      ...wiki,
                      dumps: await fetchDumps(version, wiki.wiki, {
                          start: options.start,
                          end: options.end
                      })
                  }
                : wiki
        )
    );
}

/**
 * Fetches the versions of the mediawiki history dumps
 * @param options The options of the function
 * @returns The fetched versions
 */
export async function fetchVersions(options: VersionOptions = {}): Promise<Version[]> {
    const url = WIKI_URL;
    const regex = /<a href="(?<version>\d+-\d+)\/">/g;
    const versions = await scrape(url, regex);
    const parsedVersions = versions.sort().map(version => ({
        version,
        url: `${url}/${version}`
    }));
    return await Promise.all(
        parsedVersions.map(async version =>
            options.wikies
                ? {
                      ...version,
                      wikies: await fetchWikies(version.version, {
                          lang: options.lang,
                          wikitype: options.wikitype,
                          dumps: options.dumps,
                          start: options.start,
                          end: options.end
                      })
                  }
                : version
        )
    );
}

/**
 * Fetches the latest version the mediawiki history dumps
 * @param options The options of the function
 * @returns The latest version
 */
export async function fetchLatestVersion(options: VersionOptions = {}): Promise<Version | null> {
    const url = WIKI_URL;
    const regex = /<a href="(?<version>\d+-\d+)\/">/g;
    const versions = await scrape(url, regex);
    const parsedVersion =
        versions.length > 0
            ? {
                  version: versions[0],
                  url: `${url}/${versions[0]}`
              }
            : null;
    return parsedVersion && options.wikies
        ? {
              ...parsedVersion,
              wikies: await fetchWikies(parsedVersion.version, {
                  lang: options.lang,
                  wikitype: options.wikitype,
                  dumps: options.dumps,
                  start: options.start,
                  end: options.end
              })
          }
        : parsedVersion;
}
