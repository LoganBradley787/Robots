import { describe, expect, it } from 'vitest';
import { handleBlueprintRequest, REPLAYS, type FileStore } from '../src/storage/blueprintHandler';
import { fileForName, replayFileName, slug } from '../src/storage/blueprintApi';

function memoryStore(files: Record<string, string> = {}): FileStore & { files: Record<string, string> } {
  return {
    files,
    list: () => Object.keys(files),
    read: (f) => files[f],
    write: (f, text) => {
      files[f] = text;
    },
    remove: (f) => {
      delete files[f];
    },
  };
}

describe('handleBlueprintRequest', () => {
  it('lists blueprints sorted by name, falling back to the file stem', () => {
    const store = memoryStore({ 'b.json': '{"name":"Zed"}', 'a.json': '{"name":"Alpha"}', 'broken.json': 'nope', 'notes.txt': 'x' });
    const r = handleBlueprintRequest('GET', '/', '', store);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual([
      { file: 'a.json', name: 'Alpha' },
      { file: 'broken.json', name: 'broken' },
      { file: 'b.json', name: 'Zed' },
    ]);
  });

  it('reads, writes pretty JSON with a trailing newline, and deletes', () => {
    const store = memoryStore();
    expect(handleBlueprintRequest('PUT', '/car.json', '{"format":1,"name":"car"}', store).status).toBe(200);
    expect(store.files['car.json']).toBe('{\n  "format": 1,\n  "name": "car"\n}\n');
    expect(JSON.parse(handleBlueprintRequest('GET', '/car.json', '', store).body)).toEqual({ format: 1, name: 'car' });
    expect(handleBlueprintRequest('DELETE', '/car.json', '', store).status).toBe(200);
    expect(handleBlueprintRequest('GET', '/car.json', '', store).status).toBe(404);
    expect(handleBlueprintRequest('DELETE', '/car.json', '', store).status).toBe(404);
  });

  it('rejects unsafe or malformed file names and bodies', () => {
    const store = memoryStore();
    for (const url of ['/../x.json', '/a/b.json', '/X.JSON', '/.json', '/-a.json', '/a.txt']) {
      expect(handleBlueprintRequest('PUT', url, '{}', store).status).toBe(400);
    }
    expect(handleBlueprintRequest('PUT', '/ok.json', 'not json', store).status).toBe(400);
    expect(handleBlueprintRequest('PUT', '/ok.json', '[1,2]', store).status).toBe(400);
    expect(handleBlueprintRequest('PUT', '/ok.json', `{"x":"${'a'.repeat(1_100_000)}"}`, store).status).toBe(413);
    expect(handleBlueprintRequest('POST', '/ok.json', '{}', store).status).toBe(405);
    expect(Object.keys(store.files)).toEqual([]);
  });
});

describe('slug', () => {
  it('makes safe file names', () => {
    expect(slug('Heat Seeker 2')).toBe('heat-seeker-2');
    expect(slug('  my_robot!! v3 ')).toBe('my-robot-v3');
    expect(slug('!!!')).toBe('blueprint');
    expect(slug('--car--')).toBe('car');
    expect(fileForName('Car 2')).toBe('car-2.json');
  });
});

describe('replays', () => {
  it('are written as one line and may be larger than a blueprint', () => {
    const files = new Map<string, string>();
    const store: FileStore = {
      list: () => [...files.keys()],
      read: (f) => files.get(f),
      write: (f, t) => void files.set(f, t),
      remove: (f) => void files.delete(f),
    };
    const big = JSON.stringify({ inputs: 'x'.repeat(2_000_000) });
    expect(handleBlueprintRequest('PUT', '/2026-09-23-151200-car.json', big, store, REPLAYS).status).toBe(200);
    expect(files.get('2026-09-23-151200-car.json')?.split('\n')).toHaveLength(2);
    expect(handleBlueprintRequest('GET', '/nope.json', '', store, REPLAYS).body).toContain('no replay');
  });

  it('are named by time and robot', () => {
    expect(replayFileName(new Date(2026, 8, 23, 15, 12, 7), 'Le Car')).toBe('2026-09-23-151207-le-car.json');
    expect(replayFileName(new Date(2026, 0, 2, 3, 4, 5), undefined)).toBe('2026-01-02-030405-world.json');
  });
});
