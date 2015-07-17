#ifndef DEDUP_H_
#define DEDUP_H_

#include "common.h"
#include "buf.h"

/**
 *
 * DEDUP addon for nodejs
 *
 * takes nodejs buffers and chunking them with variable length dedup
 *
 */
template <typename _Hasher>
class Dedup
{
public:
    typedef _Hasher Hasher;
    typedef typename Hasher::T T;

    /**
     * The Dedup class idefines a dedup policy.
     */
    explicit Dedup(
        const Hasher& hasher,
        int window_len,
        int min_chunk,
        int max_chunk,
        int avg_chunk_bits,
        T avg_chunk_val)
        : _hasher(hasher)
        , _window_len(window_len)
        , _min_chunk(min_chunk)
        , _max_chunk(max_chunk)
        , _avg_chunk_bits(avg_chunk_bits)
        , _avg_chunk_mask( ~((~T(0)) >> avg_chunk_bits << avg_chunk_bits) )
        , _avg_chunk_val(avg_chunk_val & _avg_chunk_mask)
    {
    }

private:
    const Hasher& _hasher;
    // window length in bytes for rolling hash
    const int _window_len;
    // minimum chunk length to avoid too small chunks, also used to fast skip for performance
    const int _min_chunk;
    // maximum chunk length to avoid too large chunks
    const int _max_chunk;
    // number of lower bits of the fingerprint used to match the hash value
    const int _avg_chunk_bits;
    // computed mask to pick just avg_chunk_bits lower bits
    const T _avg_chunk_mask;
    // hash value to match lower bits, can be any  value, but constant
    const T _avg_chunk_val;

public:

    struct ChunkHandler
    {
        virtual void handle_chunk(Buf chunk) = 0;
    };

    /**
     * The Chunker class is used to perform chunking with sliding window.
     */
    class Chunker
    {
public:

        explicit Chunker(const Dedup& dedup)
            : _dedup(dedup)
            , _window(new uint8_t[_dedup._window_len])
        {
            reset();
        }

        ~Chunker()
        {
            delete[] _window;
        }

        inline void reset()
        {
            _hash = 0;
            _window_pos = 0;
            _chunk_len = 0;
            memset(_window, 0, _dedup._window_len);
        }

        void push(Buf buf, ChunkHandler& handler);

        void flush(ChunkHandler& handler)
        {
            if (!_slices.empty()) {
                handler.handle_chunk(Buf::concat(_slices.begin(), _slices.end(), _chunk_len));
                _slices.clear();
            }
            reset();
        }

private:
        const Dedup& _dedup;
        T _hash;
        uint8_t* _window;
        int _window_pos;
        int _chunk_len;
        std::list<Buf> _slices;
    };

};

#include "dedup.hpp"

#endif // DEDUP_H_
