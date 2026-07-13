# game-assets

## tokens/ — 8색 버튼 토큰 (색상 On/Off 상태)

| 파일명 | 색상 | 역할 |
|---|---|---|
| thanksgiving2024_room_command1(_off) | 빨강 (red) | 돼지 |
| thanksgiving2024_room_command2(_off) | 주황 (orange) | 돼지 |
| thanksgiving2024_room_command3(_off) | 노랑 (yellow) | 돼지 |
| thanksgiving_room_command4(_off) | 민트 (mint) | 토끼 |
| thanksgiving_room_command5(_off) | 파랑 (blue) | 토끼 |
| thanksgiving2024_room_command6(_off) | 보라 (purple) | 돼지 |
| thanksgiving_room_command7(_off) | 분홍 (pink) | 토끼 |
| thanksgiving_room_command8(_off) | 초록 (green) | 토끼 |

`_off`가 없는 쪽은 대기(시퀀스 보드에 표시되는 기본 상태), `_off`가 눌림/처리 완료 상태.

## ui/ — 화면 구성 요소

- `thanksgiving_room_heart` / `_heart_off` — 생명(절구공이) 아이콘, 채워짐/소진 상태
- `thanksgiving_wood_mortar` — 절구(그릇) 장식 프롭
- `thanksgiving_room_time_bar` / `_time_gauge` / `_time_icon` — 4초 타이머 게이지
- `thanksgiving_room_bg` — 배경 (달+청사초롱, 추석 테마)
- `thanksgiving_room_container` / `_container_top` — 시퀀스 보드 줄 배경
- `thanksgiving_room_header` / `_header_command_box` — 상단 헤더
- `thanksgiving_room_start_player_pig` / `_rabbit` — 역할 선택 아이콘
- `thanksgiving_room_fail` — 실패 시 전체화면 오버레이 ("실패!" + 부러진 절구공이)

## characters/ — 캐릭터 리액션 스프라이트

`thanksgiving_pigman_success0-2` / `_fail0-3`, `thanksgiving_rabbitman_success0-2` / `_fail0-3` — 각 역할의 성공/실패 반응 애니메이션 프레임.
