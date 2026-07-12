import { createValidationException } from './validation-exception';

describe('createValidationException', () => {
  it('maps nested validation failures to field paths', () => {
    const exception = createValidationException([
      {
        children: [
          {
            children: [],
            constraints: { isNotEmpty: '이름을 입력해 주세요.' },
            property: 'name',
          },
        ],
        property: 'team',
      },
    ]);

    expect(exception.getResponse()).toEqual({
      code: 'VALIDATION_ERROR',
      fieldErrors: { 'team.name': ['이름을 입력해 주세요.'] },
      message: '입력값을 확인해 주세요.',
    });
  });
});
