import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extOf, fileKind, isImagePath, mimeFromExt, sendBlockKind, MAX_IMAGE_BYTES } from './file-kind.ts';

describe('extOf', () => {
  it('reads the last extension, case-insensitive', () => {
    assert.equal(extOf('D:\\\\proj\\\\A.MP4'), '.mp4');
    assert.equal(extOf('/tmp/out/index.html'), '.html');
    assert.equal(extOf('README'), '');
  });
});

describe('fileKind', () => {
  it('classifies preview families', () => {
    assert.equal(fileKind('a.png'), 'image');
    assert.equal(fileKind('clip.webm'), 'video');
    assert.equal(fileKind('talk.mp3'), 'audio');
    assert.equal(fileKind('page.HTML'), 'html');
    assert.equal(fileKind('doc.pdf'), 'pdf');
    assert.equal(fileKind('note.md'), 'markdown');
    assert.equal(fileKind('main.ts'), 'text');
    assert.equal(fileKind('archive.zip'), 'other');
  });
});

describe('isImagePath / mime / sendBlockKind', () => {
  it('treats jpeg as image', () => {
    assert.equal(isImagePath('photo.JPEG'), true);
    assert.equal(mimeFromExt('photo.jpg'), 'image/jpeg');
    assert.equal(sendBlockKind('photo.jpg', 100), 'image');
  });

  it('sends oversized images as file path references', () => {
    assert.equal(sendBlockKind('huge.png', MAX_IMAGE_BYTES + 1), 'file');
  });

  it('sends video as a file reference', () => {
    assert.equal(sendBlockKind('clip.mp4', 12), 'file');
    assert.equal(mimeFromExt('.mp4'), 'video/mp4');
  });
});
