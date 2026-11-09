import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, accessFailure, errorText } from './api-error.ts';

test('expired record never recommends retrying its code as a recovery',()=>{
  const error=new ApiError('RECORD_EXPIRED',410);
  assert.equal(accessFailure(error),'expired');
  assert.ok(errorText(error).includes('同じ学習コードや暗号化復旧ファイルでは再開できません'));
  assert.ok(errorText(error).includes('自動作成していません'));
});
test('unauthorized response distinguishes rotated keys from permanently removed records without asserting the cause',()=>{
  const error=new ApiError('UNAUTHORIZED',401);
  assert.equal(accessFailure(error),'unauthorized');
  assert.ok(errorText(error).includes('新しいコード'));
  assert.ok(errorText(error).includes('削除や期限後の消去'));
  assert.ok(errorText(error).includes('復旧できません'));
});
test('transport and service failures do not masquerade as an invalid key',()=>{
  for(const error of [new TypeError('fetch failed secret'),new ApiError('UNAVAILABLE',503),new Error('arbitrary private text'),null]){
    assert.equal(accessFailure(error),'none');
    assert.ok(errorText(error).includes('通信状態'));
    assert.ok(!errorText(error).includes('secret'));
    assert.ok(!errorText(error).includes('private'));
  }
});
test('revision, unmet requirements, invalid code and storage failures retain their specific guidance',()=>{
  assert.ok(errorText(new ApiError('REVISION_CONFLICT',409)).includes('別の操作'));
  assert.ok(errorText(new ApiError('REQUIREMENTS_UNMET',409)).includes('未達成'));
  assert.ok(errorText(new Error('INVALID_CODE')).includes('検査値'));
  assert.ok(errorText(new Error('STORAGE_UNAVAILABLE')).includes('保存を許可'));
});
